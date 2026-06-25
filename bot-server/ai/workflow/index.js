// ai/workflow/index.js
//
// Orchestrator for the router+node "Conversation Workflow" engine.
//
// runWorkflowTurn() takes the workflow, a plain STATE object, and the incoming
// user message, and returns { reply, state, diagnostics }. The caller owns
// persistence — real conversations map convo fields to/from `state`; the sandbox
// keeps `state` in an ephemeral store.
//
// Per turn:
//   0. self-correct: if state points to a switched-to flow, run THAT flow
//   1. append the user message to history
//   2. router picks the next node (or stays)
//   3. if the new node is 'auto', run its action; else execute the node prompt
//   4. run any tool calls (gated by the node's allowlist)
//   5. append the assistant reply
//   6. FLOW SWITCH: if a tool requested handing to another flow, load it, carry
//      over the conversation + basket + client data, and run its opening turn.
const { route } = require("./router");
const { executeNode } = require("./nodeExecutor");
const { resolveSetupContext } = require("./setupContext");

// Current date/time + open/closed status in Mexico (Querétaro) time. The LLM
// has no clock, so we compute it server-side and inject it as a fact each turn.
// Business hours: Mon–Fri 08:00–18:00, Sat 09:00–14:00, Sun closed.
function businessHoursContext() {
  try {
    const now = new Date();
    // Wall-clock in Mexico City, then read day/hour from it.
    const mx = new Date(now.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
    const day = mx.getDay(); // 0=Sun … 6=Sat
    const hour = mx.getHours();
    const min = mx.getMinutes();
    const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
    let open = false;
    if (day >= 1 && day <= 5) open = hour >= 8 && hour < 18;
    else if (day === 6) open = hour >= 9 && hour < 14;
    const hhmm = `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    const fecha = mx.toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "long" });
    let line = `\n- FECHA Y HORA ACTUAL (México): ${dias[day]} ${fecha}, ${hhmm}. `;
    if (open) {
      line += "ESTÁS DENTRO del horario de atención; un asesor puede responder hoy.";
    } else {
      line +=
        "ESTÁS FUERA del horario de atención (atendemos L–V 8:00–18:00 y Sáb 9:00–14:00). " +
        "Si haces un handoff, NO digas que lo atenderán de inmediato ni \"en breve\": aclara con naturalidad que el especialista lo contactará en el PRÓXIMO horario hábil.";
    }
    return line;
  } catch {
    return "";
  }
}

// Lazy-load the model to avoid require cycles at module init.
async function loadWorkflowById(id) {
  if (!id) return null;
  try {
    return await require("../../models/Workflow").findById(id);
  } catch {
    return null;
  }
}

// Extract EVERY width×length measure named in a message (deduped, sorted), so a
// single message asking for several ("6x6m y otra de 6x8m") can be quoted per
// measure. Same normalization as dimsOf, but a global match instead of the first.
const _WORD_NUM = {
  uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};
function extractAllMeasures(text) {
  let cleaned = String(text || "")
    .toLowerCase()
    .replace(/(\d)\s*(?:m\b|mts?\b|metros?\b)/g, "$1 ")
    .replace(/\bmts?\.?\b|\bmetros?\b|\bm\b/g, " ")
    .replace(/\bde\s+(?:largo|ancho|alto|altura|fondo|lado)\b/g, " ")
    .replace(/\b(?:largo|ancho|alto|altura|fondo)\s+de\b/g, " ");
  // Worded numbers ("tres por tres", "dos x dos") → digits, so the regex below
  // catches spelled-out measures too (the bot understands them like a human).
  cleaned = cleaned.replace(
    /\b(un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/g,
    (w) => String(_WORD_NUM[w] ?? w)
  );
  const re = /(\d+(?:\.\d+)?)\s*(?:[x×*]|por)\s*(\d+(?:\.\d+)?)/g;
  const seen = new Set();
  const out = [];
  let m;
  while ((m = re.exec(cleaned))) {
    const d = [Number(m[1]), Number(m[2])].sort((a, b) => a - b);
    const k = d.join("x");
    if (!seen.has(k)) { seen.add(k); out.push(d); }
  }
  return out;
}

// Detect a COMPLETED purchase ("ya la compré", "ya pagué", "acabo de comprarla",
// "ya hice el pedido", "ya quedó pagada") so the bot stops re-pitching the promo /
// re-sharing a buy link and acknowledges instead. Excludes future intent ("quiero
// comprar", "cómo compro", "voy a comprar").
// Trailing lookahead (not another letter) instead of \b — \b doesn't form a
// boundary after accented chars like "é", and this also blocks longer words
// ("comprendí" won't match "compré").
const _PAST_BUY = /\b(compr[eé]|pagu[eé]|orden[eé]|adquir[ií])(?![a-záéíóúñ])/;
const _FUTURE_BUY =
  /\b(quiero|voy a|deseo|quisiera|me gustar[ií]a|puedo|podr[ií]a|c[oó]mo|d[oó]nde)\b[^.?!]*\b(comprar|pagar|ordenar|adquirir)\b/;
function saysAlreadyBought(text) {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return false;
  if (_FUTURE_BUY.test(t)) return false; // intent to buy, not done
  if (/\bacabo de\s+(comprar|pagar|ordenar|adquirir)/.test(t)) return true;
  if (/\bhice\s+(el\s+pedido|la\s+compra|mi\s+compra)/.test(t)) return true;
  if (/\bya\b/.test(t) && (_PAST_BUY.test(t) || /\b(comprad[ao]s?|pagad[ao]s?)\b/.test(t))) return true;
  if (/\b(compr[eé]|pagu[eé])\s+(la|el|las|los|mi|una?|dos)?\s*(malla|lona|maya|promoci[oó]n|orden|pedido)/.test(t))
    return true;
  return false;
}
// Did the message ALSO ask something (so we answer it instead of just thanking)?
function hasFollowUpQuestion(text) {
  const t = String(text || "").toLowerCase();
  return /\?|cu[aá]nto|cu[aá]ndo|c[oó]mo|d[oó]nde|por qu[eé]|puedo|tienen|hay\b|me\s+(llega|env[ií]an|mandan|entregan)/.test(t);
}

// A buying-interest / price signal that names NO measure ("quiero una", "me
// interesa", "la quiero", "cuánto cuesta", "precio", "comprar"). Used to quote
// the preloaded ad measure deterministically instead of asking "¿qué medida?".
// Deliberately NOT triggered by detail questions ("quiero saber el % de sombra").
function isNoMeasureBuyingSignal(text) {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return false;
  if (/\b(la|lo)\s+quiero\b/.test(t)) return true;
  if (/\bquiero\s+(una?|el|la|comprar|esa|ese|esta|este|la\s+promoci[oó]n)\b/.test(t)) return true;
  if (/\bme\s+interesa\b/.test(t)) return true;
  if (/\bme\s+la\s+llevo\b/.test(t)) return true;
  if (/\b(quiero|deseo)\s+comprar\b|\bcomprarla\b|\bc[oó]mo\s+(la\s+)?compro\b/.test(t)) return true;
  if (/\bcu[aá]nto\s+(cuesta|vale|sale|es|ser[ií]a)\b/.test(t) || /\bqu[eé]\s+precio\b/.test(t) || /^precio\b/.test(t)) return true;
  return false;
}

// Build a fresh state object for a brand-new conversation on this workflow.
function initState(workflow, vars = {}, setupOverrides = {}) {
  return {
    workflowId: workflow._id ? String(workflow._id) : null,
    nodeId: workflow.getStartNodeId(),
    history: [], // [{ role: 'user'|'assistant', text, nodeId, at }]
    vars,
    setupOverrides, // per-conversation overrides (ad assignment / sandbox / flow switch)
    basket: [], // carried-over product basket across flow switches
  };
}

/**
 * Advance the conversation one turn.
 * @param {Workflow} workflow - a hydrated Workflow doc (may be overridden by state.workflowId)
 * @param {object} state
 * @param {string} userMessage
 * @param {object} [opts] - { sandbox: bool, _switchDepth?: number }
 * @returns {Promise<{reply: string|null, state: object, diagnostics: object}>}
 */
async function runWorkflowTurn(workflow, state, userMessage, opts = {}) {
  // 0. Self-correct: a prior turn may have switched the active flow. Always run
  // the flow the STATE points to, regardless of what the caller passed in.
  if (state.workflowId && workflow && String(workflow._id) !== state.workflowId) {
    const active = await loadWorkflowById(state.workflowId);
    if (active) workflow = active;
  }

  const vars = state.vars || {};
  const history = Array.isArray(state.history) ? [...state.history] : [];

  // Resolve the setup CONTEXT once per (flow within a) conversation.
  if (state.contextBlock === undefined) {
    try {
      const Workflow = require("../../models/Workflow");
      const familyList = Workflow.familyListOf(workflow);
      const { contextBlock, product, priceInfo, catalog, preloadedAmounts, promoPitch, promoQuote } = await resolveSetupContext(
        workflow.setup,
        state.setupOverrides,
        familyList,
        { psid: opts.psid || null, sandbox: !!opts.sandbox, personaName: opts.personaName || null, isColdStart: !!workflow.isColdStart }
      );
      state.contextBlock = contextBlock || "";
      state.product = product || null;
      state.priceInfo = priceInfo || null;
      state.catalog = catalog || null; // resolved catalog (climb): {url, kind, source}
      state.preloadedAmounts = preloadedAmounts || []; // every preloaded product's price (clamp allow-set)
      state.promoPitch = promoPitch || null; // verbatim sales pitch (sent once, on ask)
      state.promoQuote = promoQuote || null; // deterministic quote when no pitch is set
    } catch (err) {
      console.error("⚠️ setup context resolution failed:", err.message);
      state.contextBlock = "";
    }
  }
  const contextBlock = state.contextBlock || "";

  // Resolve current node (heal if missing/stale — e.g. just switched flows).
  let currentNode = workflow.getNode(state.nodeId) || workflow.getNode(workflow.getStartNodeId());
  if (!currentNode) {
    return { reply: null, state, diagnostics: { error: "workflow has no nodes" } };
  }

  // 1. record the incoming message
  if (userMessage != null && userMessage !== "") {
    history.push({ role: "user", text: String(userMessage), nodeId: currentNode.id, at: new Date() });
  }

  // 1.02 DETERMINISTIC LEAD CAPTURE. A phone (or "me llamo X") in the message IS
  // contact info — persist it even when the model doesn't call capture_lead, so a
  // handoff always carries a reachable lead and the dashboard fields fill. Runs
  // before ctx is built so ctx.lead (and persisted newState.lead) inherit it.
  if (userMessage) {
    try {
      const { extractPhone, extractName } = require("./handoffGate");
      const phone = extractPhone(String(userMessage));
      const nm = extractName(String(userMessage));
      if (phone || nm) {
        state.lead = { ...(state.lead || {}) };
        if (phone && !state.lead.phone) state.lead.phone = phone;
        if (nm && !state.lead.name) state.lead.name = nm;
      }
    } catch (err) {
      console.error("⚠️ lead capture failed:", err.message);
    }
  }

  // 1.03 PENDING-HANDOFF RESUME. Last turn we asked for name + phone before
  // completing a handoff. Capture a bare-name reply too, then complete the handoff
  // now (with whatever contact we have) — one ask only, we never nag or trap.
  if (userMessage && state.pendingHandoff) {
    try {
      const { looksLikeBareName } = require("./handoffGate");
      if (!(state.lead && state.lead.name) && looksLikeBareName(String(userMessage))) {
        state.lead = { ...(state.lead || {}), name: String(userMessage).trim() };
      }
      const reason = state.pendingHandoff.reason || "El cliente requiere atención de un asesor";
      const who = state.lead && state.lead.name ? `, ${String(state.lead.name).split(/\s+/)[0]}` : "";
      const reply = `¡Gracias${who}! 🙌 Un asesor te contactará lo antes posible para ayudarte.`;
      history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
      return {
        reply,
        state: { ...state, history, lead: state.lead || null, location: state.location || null, nodeId: currentNode.id, pendingHandoff: null },
        diagnostics: {
          workflow: { id: String(workflow._id), name: workflow.name },
          fromNode: { id: currentNode.id, name: currentNode.name },
          toNode: { id: currentNode.id, name: currentNode.name },
          handoffRequested: true,
          handoffReason: reason,
          handoffResumed: true,
        },
      };
    } catch (err) {
      console.error("⚠️ pending-handoff resume failed:", err.message);
      state.pendingHandoff = null;
    }
  }

  // 1.05 ALREADY-PURCHASED. The customer signals the sale is DONE ("ya la compré",
  // "ya pagué", "acabo de comprarla"). NEVER re-pitch the promo or re-share a buy
  // link at them — acknowledge the purchase. Dismiss the promo so it vanishes from
  // context now and on future turns. If they ALSO asked something ("ya la compré,
  // ¿cuándo llega?"), let the model answer (promo dismissed so it won't re-sell).
  if (userMessage && !state.purchased && saysAlreadyBought(String(userMessage))) {
    state.purchased = true;
    state.promoDismissed = true;
    if (!hasFollowUpQuestion(String(userMessage))) {
      const reply =
        "¡Qué gusto! 🙌 Muchas gracias por tu compra. Si tienes cualquier duda con tu pedido o necesitas algo más, aquí estoy para ayudarte. 😊";
      history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
      return {
        reply,
        state: { ...state, history, nodeId: currentNode.id },
        diagnostics: {
          workflow: { id: String(workflow._id), name: workflow.name },
          fromNode: { id: currentNode.id, name: currentNode.name },
          toNode: { id: currentNode.id, name: currentNode.name },
          alreadyPurchased: true,
        },
      };
    }
    // else fall through: the message also asked something → the model answers it,
    // but the promo is dismissed so it won't try to re-sell.
  }

  // 1.06 MEASURE CLARIFY RESUME. Last turn we asked the client to choose between
  // two products that share the asked measure (different families). Match their
  // reply to a candidate and switch to that flow; if unclear, re-ask once, then
  // give up and let the conversation continue normally.
  if (
    userMessage &&
    state.pendingMeasureClarify &&
    Array.isArray(state.pendingMeasureClarify.candidates) &&
    state.pendingMeasureClarify.candidates.length
  ) {
    try {
      const pend = state.pendingMeasureClarify;
      const { matchClarifyReply, buildClarifyQuestion } = require("./measureRouter");
      const idx = await matchClarifyReply(String(userMessage), pend.candidates);
      if (idx >= 0 && (opts._switchDepth || 0) < 2) {
        const chosen = pend.candidates[idx];
        state.pendingMeasureClarify = null;
        const handover = await performSwitch(
          { toWorkflowId: chosen.toWorkflowId, toName: chosen.toName, product: chosen.product },
          { history, vars, lead: state.lead || null, location: state.location || null, basket: state.basket || [], opts }
        );
        if (handover) {
          return {
            reply: handover.reply,
            state: { ...handover.state, pendingMeasureClarify: null },
            diagnostics: {
              workflow: { id: String(workflow._id), name: workflow.name },
              measureClarifyResolved: true,
              switchedTo: handover.switchedTo,
              afterSwitch: handover.diagnostics,
            },
          };
        }
      }
      // Unclear answer (or switch failed). Re-ask ONCE; after that, give up and
      // let normal handling take over so we never loop.
      if ((pend.tries || 0) < 1) {
        const q = buildClarifyQuestion(pend.candidates, pend.dims);
        history.push({ role: "assistant", text: q, nodeId: currentNode.id, at: new Date() });
        return {
          reply: q,
          state: { ...state, history, nodeId: currentNode.id, pendingMeasureClarify: { ...pend, tries: (pend.tries || 0) + 1 } },
          diagnostics: {
            workflow: { id: String(workflow._id), name: workflow.name },
            fromNode: { id: currentNode.id, name: currentNode.name },
            toNode: { id: currentNode.id, name: currentNode.name },
            measureClarifyReask: true,
          },
        };
      }
      state.pendingMeasureClarify = null; // gave up → fall through to normal flow
    } catch (err) {
      console.error("⚠️ measure clarify resume failed:", err.message);
      state.pendingMeasureClarify = null;
    }
  }

  // 1.1 VERBATIM PROMO PITCH (sent ONCE, when the customer asks about the promo).
  // If the active promo has a sales pitch and we haven't sent it, a tiny gpt-4o-mini
  // intent check decides whether THIS message asks for the promo. If so, we send
  // the pitch EXACTLY as written and return — skipping the router, node LLM and
  // verifier entirely (token-cheap). When there's no pitch, this never runs and
  // the LLM handles the promo normally.
  // Runs when the pitch hasn't been sent yet, OR when the promo was dismissed
  // (client pivoted to another measure) — so a customer CIRCLING BACK to ask for
  // the promo re-surfaces it. The verbatim pitch is sent only once; re-asks get
  // the cheap deterministic quote.
  if (userMessage && !state.purchased && (state.promoPitch || state.promoQuote) && (!state.promoPitchSent || state.promoDismissed)) {
    try {
      const { wantsPromo } = require("../utils/promoIntent");
      if (await wantsPromo(String(userMessage))) {
        // The promo is relevant again → un-dismiss so its context returns for
        // follow-up turns too.
        state.promoDismissed = false;
        // First time with a pitch → send the verbatim pitch; otherwise (re-ask, or
        // no pitch) send the deterministic quote (product + promo price + link).
        let reply = null;
        let kind = null;
        if (state.promoPitch && !state.promoPitchSent) {
          reply = String(state.promoPitch);
          kind = "verbatimPitch";
        } else if (state.promoQuote && state.promoQuote.amount) {
          const q = state.promoQuote;
          const label = q.label ? q.label.charAt(0).toUpperCase() + q.label.slice(1) : "El producto en promoción";
          reply =
            `¡Claro! ${label} está en promoción por $${q.amount}.` +
            (q.link ? ` Puedes comprarla aquí: ${q.link}` : "");
          kind = "promoQuote";
        } else if (state.promoPitch) {
          reply = String(state.promoPitch); // pitch already sent but no quote available → repeat pitch
          kind = "verbatimPitch";
        }
        if (reply) {
          history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
          // The promo product is the active one again, so a follow-up ("Porfa")
          // re-resolves THE PROMO's price, not the previously-asked measure.
          const promoProductId = state.product && state.product._id ? String(state.product._id) : (state.activeProductId || null);
          return {
            reply,
            state: { ...state, history, promoPitchSent: true, promoDismissed: false, activeProductId: promoProductId, nodeId: currentNode.id },
            diagnostics: {
              workflow: { id: String(workflow._id), name: workflow.name },
              fromNode: { id: currentNode.id, name: currentNode.name },
              toNode: { id: currentNode.id, name: currentNode.name },
              [kind]: true,
            },
          };
        }
      }
    } catch (err) {
      console.error("⚠️ promo pitch/quote check failed:", err.message);
      // fall through to normal LLM handling
    }
  }

  // 1.2 HARD DEFAULT-MEASURE GUARANTEE. The customer came from an ad for a specific
  // measure (state.product) and now shows buying interest WITHOUT naming another
  // measure ("quiero una", "me interesa", "cuánto cuesta", "precio"). Don't let the
  // model ask "¿qué medida?" — deterministically quote the preloaded default
  // (price + link), the same way the promo/zip/purchase fast-paths short-circuit.
  // Skipped once the client pivoted (promoDismissed) or already bought.
  if (
    userMessage &&
    !state.purchased &&
    !state.promoDismissed &&
    state.product &&
    state.product._id &&
    isNoMeasureBuyingSignal(String(userMessage)) &&
    extractAllMeasures(String(userMessage)).length === 0
  ) {
    try {
      const PF = require("../../models/ProductFamily");
      const { resolvePrice, trackedLink } = require("./priceResolver");
      let amount = null, link = null, plusIva = false, label = null, isPromo = false;
      // Prefer the already-resolved promo quote; else resolve the default product now.
      if (state.promoQuote && Number.isFinite(state.promoQuote.amount) && state.promoQuote.amount > 0) {
        amount = state.promoQuote.amount;
        link = state.promoQuote.link || null;
        label = state.promoQuote.label || null;
        isPromo = true;
      } else {
        const doc = await PF.findById(state.product._id).lean().catch(() => null);
        if (doc && doc.sellable) {
          const pi = await resolvePrice(doc);
          if (pi && pi.amount) {
            amount = pi.amount;
            plusIva = !!pi.plusIva;
            label = doc.size || doc.name;
            link = await trackedLink(pi.link, {
              psid: opts.psid || null,
              sandbox: !!opts.sandbox,
              productName: doc.name,
              productId: String(doc._id),
            });
          }
        }
      }
      if (amount) {
        const name = label
          ? label.charAt(0).toUpperCase() + label.slice(1)
          : "La malla sombra";
        const reply =
          `¡Claro! ${name}${isPromo ? " está en promoción por" : " tiene un precio de"} $${amount}${plusIva ? " + IVA" : ""}.` +
          (link ? ` Puedes comprarla aquí: ${link}` : "");
        history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
        return {
          reply,
          state: {
            ...state,
            history,
            nodeId: currentNode.id,
            activeProductId: String(state.product._id),
            priceInfo: { amount, source: isPromo ? "promo" : "ml", link, plusIva, handoff: false },
          },
          diagnostics: {
            workflow: { id: String(workflow._id), name: workflow.name },
            fromNode: { id: currentNode.id, name: currentNode.name },
            toNode: { id: currentNode.id, name: currentNode.name },
            defaultMeasureQuote: true,
          },
        };
      }
    } catch (err) {
      console.error("⚠️ default-measure guarantee failed:", err.message);
      // fall through to normal LLM handling
    }
  }

  const familyList = require("../../models/Workflow").familyListOf(workflow);

  // 1.4 DETERMINISTIC MEASURE ROUTER ("no flow, no offer"). When the customer
  // names a measure, route by the CATALOG: which active SPECIALIST flow(s) sell a
  // product at that exact W×L. One offer → switch to it; two+ → ask which (a human
  // would too); none → fall through to the LLM scope classifier below. Subsumes
  // the confeccionada-vs-rollo split (a 100 m measure only exists in the rollo
  // flow's realm) with no length heuristic.
  let skipLLMSwitch = false;
  if (userMessage && (opts._switchDepth || 0) < 2 && !opts.sandboxNoAutoSwitch) {
    try {
      const { dimsOf } = require("./tools");
      const earlyDims = dimsOf(String(userMessage)) || extractAllMeasures(String(userMessage))[0] || null;
      if (earlyDims) {
        const { routeByMeasure, buildClarifyQuestion } = require("./measureRouter");
        const r = await routeByMeasure(String(userMessage), earlyDims, String(workflow._id));
        if (r.action === "switch") {
          const handover = await performSwitch(
            { toWorkflowId: r.toWorkflowId, toName: r.toName, product: r.product },
            { history, vars, lead: state.lead || null, location: state.location || null, basket: state.basket || [], opts }
          );
          if (handover) {
            return {
              reply: handover.reply,
              state: handover.state,
              diagnostics: {
                workflow: { id: String(workflow._id), name: workflow.name },
                measureAutoSwitch: true,
                switchedTo: handover.switchedTo,
                afterSwitch: handover.diagnostics,
              },
            };
          }
        } else if (r.action === "clarify") {
          const q = buildClarifyQuestion(r.candidates, earlyDims);
          history.push({ role: "assistant", text: q, nodeId: currentNode.id, at: new Date() });
          return {
            reply: q,
            state: {
              ...state,
              history,
              nodeId: currentNode.id,
              pendingMeasureClarify: { dims: earlyDims, candidates: r.candidates, tries: 0 },
            },
            diagnostics: {
              workflow: { id: String(workflow._id), name: workflow.name },
              fromNode: { id: currentNode.id, name: currentNode.name },
              toNode: { id: currentNode.id, name: currentNode.name },
              measureClarify: true,
            },
          };
        } else if (r.action === "stay") {
          skipLLMSwitch = true; // current flow owns this measure → don't switch away
        }
      }
    } catch (err) {
      console.error("⚠️ measure router failed:", err.message);
    }
  }

  // 1.5 ENGINE-SIDE OUT-OF-FAMILY DETECTION (does not rely on the model calling a
  // tool). If the customer's message points at a product handled by ANOTHER active
  // flow, switch deterministically — product switches need no confirmation.
  if (userMessage && !skipLLMSwitch && (opts._switchDepth || 0) < 2 && !opts.sandboxNoAutoSwitch) {
    try {
      const det = await detectFlowSwitch(String(userMessage), familyList, workflow);
      if (det && det.toWorkflowId) {
        const handover = await performSwitch(det, {
          history,
          vars,
          lead: state.lead || null,
          location: state.location || null,
          basket: state.basket || [],
          opts,
        });
        if (handover) {
          return {
            reply: handover.reply,
            state: handover.state,
            diagnostics: {
              workflow: { id: String(workflow._id), name: workflow.name },
              autoSwitch: true,
              switchedTo: { id: det.toWorkflowId, name: det.toName },
              detectedProduct: det.product?.name,
              afterSwitch: handover.diagnostics,
            },
          };
        }
      }
    } catch (err) {
      console.error("⚠️ auto flow-switch detection failed:", err.message);
    }
  }

  // 1.6 ENGINE-SIDE IN-FAMILY MEASURE PRICING (does not rely on the model calling
  // share_product_link). If the customer named a measure that exists in THIS
  // flow's families, resolve its price/link now and inject it into this turn's
  // context, so the model quotes it deterministically instead of vague-replying
  // or escalating to a human.
  let turnPriceInfo = state.priceInfo || null;
  // When this turn's price resolution decides a human must validate the price
  // (e.g. no live ML + inventario below the last-synced ML), we fire a REAL
  // handoff with this reason — not just a textual "te paso con un asesor".
  let turnHandoffReason = null;
  // True when the customer asked for a SPECIFIC measure this turn and we resolved
  // its real price. In that case the promo/preloaded default price must NOT be an
  // allowed substitute for it (that's how the 6x4 promo $655 leaked onto a 3x5).
  let askedMeasureResolved = false;
  // The ACTIVE product the customer is being quoted. Updated whenever a measure
  // resolves; carried across turns so a follow-up ("Porfa", "sí") still re-resolves
  // THIS product's price from ML — never reverts to the promo/default.
  let turnActiveProductId = state.activeProductId || null;
  // DETERMINISTIC PRICE CLAMP — collect every price the engine actually RESOLVES
  // this turn. The outgoing reply may only quote one of these; any other number
  // gets rewritten to `primaryQuoteAmount` (the measure the customer asked about).
  // See clampPrices in priceResolver.js. Empty set → clamp is a no-op.
  const allowedAmounts = [];
  let primaryQuoteAmount = null;
  const noteAmount = (pi, makePrimary) => {
    if (!pi) return;
    if (Number.isFinite(pi.amount) && pi.amount > 0) {
      allowedAmounts.push(pi.amount);
      if (makePrimary) primaryQuoteAmount = pi.amount;
    }
    if (Number.isFinite(pi.originalPrice) && pi.originalPrice > 0) allowedAmounts.push(pi.originalPrice);
  };
  // Every preloaded product's resolved price is legit to mention (but none is
  // the rewrite target — that's the measure the customer actually asks about).
  // Including ALL of them stops the clamp from corrupting a correct multi-product
  // quote (e.g. rewriting the 54 m's $1599 down to the 18 m's $689).
  // NOTE: the carried/preloaded prices are added LATER (after this turn's measure
  // resolution) — and ONLY when the customer didn't pivot to a different-priced
  // measure — so the promo/default price can't substitute for an asked measure.
  // Current date/time + business-hours status (Mexico). The model has no clock;
  // inject it FRESH each turn so the handoff node can tell the customer whether
  // a specialist responds now or in the next business window.
  let turnContextExtra = businessHoursContext();
  let turnColors = null;
  if (userMessage) {
    try {
      // AI measure extraction (customer free-text) — done ONCE per turn and
      // threaded into the lookups, so any phrasing parses ("13 de largo x 3 de
      // ancho", "mide 13 por 3", worded numbers) without regex whack-a-mole.
      const { extractMeasure } = require("../utils/measureExtractor");
      const { dimsOf } = require("./tools");
      // Prefer the AI extractor, but FALL BACK to the deterministic dims parse —
      // the extractor whiffs on some phrasings (e.g. "el precio de 6*8" with a
      // "*" separator in prose), and dimsOf handles x/×/* reliably. Without this
      // fallback the measure went unresolved and the node wrongly escalated.
      // extractMeasure (AI) is inconsistent on some phrasings ("precio de tres x
      // tres" → null even though "tres x tres" works); dimsOf only sees digits.
      // extractAllMeasures normalizes worded numbers deterministically, so use its
      // first hit as a final fallback — worded single-measures never go unparsed.
      const wantDims =
        (await extractMeasure(String(userMessage))) ||
        dimsOf(String(userMessage)) ||
        extractAllMeasures(String(userMessage))[0] ||
        null;

      // ── MULTI-MEASURE ─────────────────────────────────────────────────────
      // If the message names 2+ measures ("6x6m y otra de 6x8m"), quote EACH with
      // its OWN price + link — never collapse to one. Each resolved price is added
      // to the clamp's allow-set so the multi-line quote survives.
      let multiHandled = false;
      const allMeasures = extractAllMeasures(String(userMessage));
      if (allMeasures.length >= 2) {
        const { findProductInFamilies } = require("./tools");
        const { resolvePrice, trackedLink } = require("./priceResolver");
        turnPriceInfo = null; // a multi-quote has no single price → no clamp primary, no carried-promo pollution
        const lines = [];
        let resolvedAny = false;
        for (const d of allMeasures) {
          const doc = await findProductInFamilies(String(userMessage), familyList, d);
          if (!doc) {
            lines.push(`  • ${d[0]}x${d[1]}m: no es medida estándar — ofrécele la más cercana o pásalo con un asesor.`);
            continue;
          }
          const pi = await resolvePrice(doc);
          if (pi && pi.amount) {
            resolvedAny = true;
            turnActiveProductId = String(doc._id);
            noteAmount(pi, false); // each price is allowed; no single primary in a multi-quote
            const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: doc.name, productId: String(doc._id) });
            lines.push(`  • ${d[0]}x${d[1]}m: $${pi.amount}${pi.plusIva ? " + IVA" : ""}${link ? ` → ${link}` : ""}`);
          } else if (pi && pi.handoff) {
            lines.push(`  • ${d[0]}x${d[1]}m: sin precio confirmado — pásalo con un asesor para el precio.`);
            turnHandoffReason = turnHandoffReason || `Cotización ${d[0]}x${d[1]}m: ${pi.handoffReason || "validar precio con un asesor"}`;
          }
        }
        if (resolvedAny) {
          askedMeasureResolved = true;
          const pinnedId = state.product && state.product._id ? String(state.product._id) : null;
          if (!pinnedId || turnActiveProductId !== pinnedId) state.promoDismissed = true;
        }
        turnContextExtra +=
          `\n- COTIZACIÓN MÚLTIPLE: el cliente pidió varias medidas en un mismo mensaje. Cotiza CADA una con SU PROPIO precio y SU PROPIO link (una línea por medida); NUNCA uses el mismo precio o link para dos medidas distintas:\n${lines.join("\n")}`;
        multiHandled = true;
      }

      const found = multiHandled ? null : await resolveInFamilyMeasure(String(userMessage), familyList, wantDims);
      if (multiHandled) {
        // handled above
      } else if (found && found.priceInfo) {
        turnPriceInfo = found.priceInfo;
        const pi = found.priceInfo;
        // This is the measure the customer asked about THIS turn → the canonical
        // price + the rewrite target for the clamp.
        noteAmount(pi, true);
        if (pi.handoff) {
          // Reference the ACTUAL measure the customer asked for (never the leaf
          // name like "Color Beige", which made the model invent a size such as
          // "7x10"). Fire a real handoff with the deterministic reason.
          const askedMeasure = wantDims ? `${wantDims[0]}x${wantDims[1]}m` : found.name;
          turnHandoffReason =
            `Cotización ${askedMeasure}: ${pi.handoffReason || "requiere validación de precio con un asesor"}`;
          turnContextExtra =
            `\n- COTIZACIÓN SOLICITADA: la medida ${askedMeasure} requiere que un asesor confirme el precio. ` +
            `NO inventes un precio NI otra medida; dile al cliente con naturalidad que lo pasas con un asesor para confirmarle el precio de ${askedMeasure}.`;
        } else if (pi.amount) {
          // The customer asked a specific measure and we resolved its real price.
          askedMeasureResolved = true;
          turnActiveProductId = found.id; // this product is now the active one
          // The pinned promo/default is a VOLATILE startup guide: the moment the
          // client asks for a DIFFERENT measure it must VANISH from context. Mark
          // it dismissed (persisted) unless they asked for the pinned measure itself.
          const pinnedId = state.product && state.product._id ? String(state.product._id) : null;
          if (!pinnedId || String(found.id) !== pinnedId) state.promoDismissed = true;
          // psid-traceable link so a click here is attributed (commerce-status).
          const { trackedLink } = require("./priceResolver");
          const link = await trackedLink(pi.link, {
            psid: opts.psid || null,
            sandbox: !!opts.sandbox,
            productName: found.name,
            productId: found.id,
          });
          turnContextExtra =
            `\n- COTIZACIÓN SOLICITADA AHORA: el cliente pregunta por "${found.name}". Precio $${pi.amount}${pi.plusIva ? " + IVA" : ""}${pi.source === "ml" ? " (Mercado Libre)" : " (inventario)"}.` +
            (link ? ` Link: ${link}.` : "") +
            (pi.plusIva ? ` Este precio es MÁS IVA: al cotizar di SIEMPRE "$${pi.amount} + IVA" o "más IVA".` : "") +
            ` Cotiza ESTE producto con su precio y link; NO escales a un humano ni pidas la medida de nuevo.`;
        }
        // Available colors/variants for the requested size — so the bot can
        // answer "¿tienes otros colores?" with the real options instead of
        // defaulting to "solo beige" / handoff. Persisted to state below so
        // the answer survives across turns (the color question usually comes
        // a turn AFTER the measure).
        if (found.variants && found.variants.length > 1) {
          // Each color gets its OWN tracked link — never reuse one link for all
          // (that bug shipped the same URL for Beige and Verde).
          const { trackedLink } = require("./priceResolver");
          const options = [];
          for (const v of found.variants) {
            const vlink = v.link
              ? await trackedLink(v.link, {
                  psid: opts.psid || null,
                  sandbox: !!opts.sandbox,
                  productName: `${found.size || ""} ${v.label}`.trim(),
                })
              : null;
            options.push({ label: v.label, link: vlink });
          }
          turnColors = { size: found.size || null, options };
        }
      } else if (wantDims) {
        // The customer named a MEASURE we couldn't resolve in catalog (e.g.
        // 13x3 — out of range). Find the closest available size so the bot
        // offers a REAL size and asks if they still want the exact one —
        // instead of inventing a size or saying "no manejamos decimales".
        const toolsMod = require("./tools");
        const closest = await toolsMod.closestAvailableMeasure(String(userMessage), familyList, wantDims);
        if (closest) {
          if (Number.isFinite(closest.price) && closest.price > 0) {
            allowedAmounts.push(closest.price);
            if (primaryQuoteAmount == null) primaryQuoteAmount = closest.price;
          }
          turnContextExtra +=
            `\n- MEDIDA NO DISPONIBLE: la medida exacta que pidió el cliente NO está en catálogo. La más cercana que sí manejamos es "${closest.label}"${closest.price != null ? ` ($${closest.price})` : ""}. ` +
            `Ofrécele ESTA medida más cercana y pregúntale si le sirve o si necesita la medida exacta. ` +
            `NO inventes una medida, NO inventes precios, y NUNCA digas "no manejamos decimales" (la medida pedida puede no tener decimales). Si insiste en la medida exacta, ofrécele pasar con un asesor.`;
        }
      } else if (turnActiveProductId) {
        // NO measure in THIS message, but there's an ACTIVE product (e.g. the
        // customer asked "3x4" earlier and now just says "Porfa"/"sí"). The price
        // is BOUND to the product: re-resolve ITS price from ML (first rule) so a
        // follow-up never reverts to the promo/default price.
        const PF = require("../../models/ProductFamily");
        const { resolvePrice, trackedLink } = require("./priceResolver");
        const doc = await PF.findById(turnActiveProductId).lean().catch(() => null);
        if (doc && doc.sellable) {
          const pi = await resolvePrice(doc);
          turnPriceInfo = pi;
          if (pi && pi.handoff) {
            turnHandoffReason = `Cotización ${doc.size || doc.name}: ${pi.handoffReason || "requiere validación de precio con un asesor"}`;
            turnContextExtra =
              `\n- COTIZACIÓN: la medida ${doc.size || doc.name} requiere que un asesor confirme el precio. NO inventes un precio; dile que lo pasas con un asesor.`;
          } else if (pi && pi.amount) {
            askedMeasureResolved = true;
            const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: doc.name, productId: turnActiveProductId });
            turnContextExtra =
              `\n- PRODUCTO ACTIVO: el cliente sigue tratando "${doc.name}" (${doc.size || ""}). Precio $${pi.amount}${pi.plusIva ? " + IVA" : ""}${pi.source === "ml" ? " (Mercado Libre)" : " (inventario)"}.` +
              (link ? ` Link: ${link}.` : "") +
              (pi.plusIva ? ` Este precio es MÁS IVA: di SIEMPRE "$${pi.amount} + IVA".` : "") +
              ` Cotiza ESTE producto con su precio y link; NUNCA uses el precio de otra medida ni de la promoción.`;
          }
        }
      }
    } catch (err) {
      console.error("⚠️ in-family measure pricing failed:", err.message);
    }
  }

  // Carried/preloaded prices (e.g. the promo 6x4 $655) are legit to mention ONLY
  // when the customer did NOT pivot to a different-priced measure this turn. If
  // they asked for 3x5 ($629), the promo $655 must NOT be an allowed substitute —
  // otherwise the clamp lets the model quote the 3x5 at the promo price. Keep the
  // preloaded amounts when the asked measure IS one of them (multi-product quotes,
  // e.g. borde 54m + 18m) so the clamp doesn't corrupt a correct multi-line quote.
  // Once the promo/default is dismissed (client asked a different measure), its
  // price vanishes from the clamp's allow-set too — never a substitute again.
  const preloaded = state.promoDismissed ? [] : (state.preloadedAmounts || []).filter((a) => Number.isFinite(a) && a > 0);
  // The ACTIVE measure being quoted — resolved THIS turn, or CARRIED from a prior
  // turn (the customer asked "3x4" and now just says "Porfa"). Its price is the
  // canonical one + the clamp's rewrite target, so a promo/preloaded price can't
  // substitute for it on a follow-up turn. (turnPriceInfo = this turn's resolution
  // or the carried state.priceInfo.)
  const activePI = turnPriceInfo && Number.isFinite(turnPriceInfo.amount) && turnPriceInfo.amount > 0 ? turnPriceInfo : null;
  if (activePI) {
    if (primaryQuoteAmount == null) primaryQuoteAmount = activePI.amount;
    noteAmount(activePI, false); // allow the active measure's price (+ its originalPrice)
  }
  // Keep the preloaded amounts only when the active measure IS one of them (e.g. the
  // customer is on the promo product, or borde 54m+18m multi-quote) — otherwise the
  // promo price must NOT be allowed to stand in for a different measure.
  const pivotedToDifferentPrice = activePI != null && !preloaded.includes(activePI.amount);
  if (!pivotedToDifferentPrice) {
    noteAmount(state.priceInfo, false);
    for (const a of preloaded) allowedAmounts.push(a);
  }

  // If no measure THIS turn but we resolved colors on a previous turn (same
  // active size), keep offering them — the "¿otros colores?" follow-up almost
  // always lands on its own turn.
  if (!turnColors && state.availableColors && state.availableColors.options?.length > 1) {
    turnColors = state.availableColors;
  }
  if (turnColors && turnColors.options?.length > 1) {
    // options may be strings (legacy persisted state) or {label, link}.
    const labelOf = (o) => (typeof o === "string" ? o : o.label);
    const linkOf = (o) => (typeof o === "string" ? null : o.link);
    const lines2 = turnColors.options
      .map((o) => (linkOf(o) ? `${labelOf(o)} → ${linkOf(o)}` : labelOf(o)))
      .join("; ");
    turnContextExtra +=
      `\n- COLORES DISPONIBLES${turnColors.size ? ` para ${turnColors.size}` : ""}: ${lines2}. ` +
      `Comparte el link que corresponde a CADA color — cada uno tiene su PROPIO link, NUNCA reutilices el mismo link para colores distintos. ` +
      `No digas "solo beige" ni escales a un asesor por color.`;
  }

  // Effective context: the pinned promo/default lines are tagged with §D§. Once
  // the client pivots to a different measure (promoDismissed), those lines VANISH;
  // otherwise just strip the tag so they read normally. The tag never reaches the model.
  const effectiveContext = state.promoDismissed
    ? contextBlock.split("\n").filter((l) => !l.includes("§D§")).join("\n")
    : contextBlock.replace(/§D§/g, "");

  // 2. route
  const decision = await route(workflow, currentNode, history, effectiveContext);
  const movedTo = workflow.getNode(decision.nextNodeId) || currentNode;

  // 3 + 4. execute the (possibly new) active node
  const ctx = {
    sandbox: !!opts.sandbox,
    actions: [],
    notes: [],
    handoffRequested: false,
    switchTo: null, // a tool may set { toWorkflowId, toName, product } to switch flows
    lead: state.lead || null,
    location: state.location || null,
    product: state.product || null,
    priceInfo: turnPriceInfo, // turn-scoped: the measure the client just asked for
    families: familyList, // realm (for scope checks)
    currentFlowName: workflow.name, // for the AI product-scope classifier
    isColdStart: !!workflow.isColdStart, // triage flow → always route out, never claim a product
    catalog: state.catalog || null, // resolved catalog for share_catalog tool
    catalogToSend: null, // set by share_catalog → maybeRunAdWorkflow sends the document
    psid: opts.psid || null, // enables psid-traceable links in share_* tools
  };
  // DETERMINISTIC HANDOFF: if this turn's price resolution needs human price
  // validation, escalate for real (set the flag the caller acts on) with the
  // concrete reason — so it's recorded, the brief is handed over, and the
  // dashboard shows WHY, instead of the bot just saying "te paso con un asesor".
  if (turnHandoffReason) {
    ctx.handoffRequested = true;
    ctx.handoffReason = turnHandoffReason;
  }
  const { text: rawText, toolCalls, llmError: nodeLlmError } = await executeNode(
    workflow,
    movedTo,
    history,
    vars,
    ctx,
    effectiveContext + turnContextExtra
  );

  // RESILIENCE: if the engine's LLM calls failed (router or node) and we got no
  // usable text, DON'T go silent — degrade to a human handoff so the customer
  // gets a reply and an agent is alerted, instead of being ghosted by a
  // transient OpenAI outage (429 / timeout / 5xx).
  let text = rawText;
  if ((decision.llmError || nodeLlmError) && !text) {
    ctx.handoffRequested = true;
    ctx.handoffReason = ctx.handoffReason || "Fallo temporal del motor de IA — pasar a un asesor para no dejar al cliente sin respuesta";
    text = "Permíteme un momento, te comunico con un asesor para ayudarte mejor. 🙌";
    console.warn(`⚠️ [workflow] LLM failure → degrading to human handoff for ${opts.psid || "(no psid)"}`);
  }

  // COLLECT-BEFORE-HANDOFF GATE (engine port of preHandoffCheck). Before
  // completing an intentional handoff, make sure the human gets a reachable lead.
  // If we have no contact yet, ask ONCE for name + phone and PARK the handoff
  // (state.pendingHandoff); the resume above completes it next turn with whatever
  // they give. Skip during an LLM-outage handoff (escalate immediately).
  if (ctx.handoffRequested && !(decision.llmError || nodeLlmError) && !state.pendingHandoff) {
    const haveContact = !!(
      (ctx.lead && (ctx.lead.phone || ctx.lead.email || ctx.lead.name)) ||
      (state.lead && (state.lead.phone || state.lead.email || state.lead.name))
    );
    if (!haveContact) {
      const ask = "¡Con gusto te paso con un asesor! 🙌 ¿Me compartes tu nombre y un teléfono para que te contacte?";
      history.push({ role: "assistant", text: ask, nodeId: movedTo.id, at: new Date() });
      return {
        reply: ask,
        state: {
          ...state,
          history,
          vars,
          lead: ctx.lead || state.lead || null,
          location: ctx.location || state.location || null,
          nodeId: movedTo.id,
          pendingHandoff: { reason: ctx.handoffReason || null, attempts: 1 },
        },
        diagnostics: {
          workflow: { id: String(workflow._id), name: workflow.name },
          fromNode: { id: currentNode.id, name: currentNode.name },
          toNode: { id: movedTo.id, name: movedTo.name },
          handoffPendingContact: true,
        },
      };
    }
    // have contact → fall through; the handoff completes normally, now WITH a
    // reachable lead in the brief.
  }

  // A share_product_link / quote tool call returns the canonical "Precio: $X" —
  // add it to the clamp's allowed set (it's a price the engine resolved).
  for (const t of toolCalls || []) {
    if (t && t.output && /share_product_link|quote|cotiz/i.test(t.name || "")) {
      const mm = String(t.output).match(/Precio:\s*\$?\s*([\d,]+(?:\.\d+)?)/i);
      if (mm) {
        const v = parseFloat(mm[1].replace(/,/g, ""));
        if (Number.isFinite(v) && v > 0) {
          allowedAmounts.push(v);
          if (primaryQuoteAmount == null) primaryQuoteAmount = v;
        }
      }
    }
  }

  // GROUNDING CHECK: verify the model's reply against the facts in context
  // (realm/shade%, available measures, colors, price) before sending — catches
  // a fabricated spec the model asserted (e.g. confirming "95%" when the family
  // is 90%) and corrects it. Only on real model output (not the canned fallback
  // above, not empty replies). Data-driven; never blocks (returns original on
  // error).
  if (text && !(decision.llmError || nodeLlmError)) {
    try {
      const { verifyReply } = require("./replyVerifier");
      // Include the TURN's tool outputs (e.g. share_product_link's "Precio:
      // $599") in the facts — the price/spec often comes from a tool call, not
      // the pre-injected context. Without this the verifier was blind to it
      // (the $1128-on-a-$599-product case slipped through).
      const toolFacts = (toolCalls || [])
        .filter((t) => t && t.output)
        .map((t) => `- [${t.name}] devolvió: ${t.output}`)
        .join("\n");
      const facts = `${effectiveContext}${turnContextExtra}${toolFacts ? "\n" + toolFacts : ""}`;
      const v = await verifyReply(text, facts);
      if (v.corrected) {
        console.warn(`🛡️ [workflow] reply corrected by grounding check for ${opts.psid || "(no psid)"}`);
        text = v.reply;
      }
    } catch (e) {
      console.error("⚠️ workflow grounding check failed:", e.message);
    }
  }

  // DETERMINISTIC PRICE CLAMP — runs LAST (after the verifier, which is itself an
  // LLM and could reintroduce a wrong number). Prices are not the model's to
  // author: any price token that isn't one the engine resolved this turn is
  // rewritten to the price of the measure the customer asked about. No-op when
  // nothing was resolved (overview/range/chit-chat turns).
  if (text) {
    try {
      const { clampPrices } = require("./priceResolver");
      const clamp = clampPrices(text, allowedAmounts, primaryQuoteAmount);
      if (clamp.changed) {
        console.warn(
          `🔒 [workflow] price clamp rewrote a non-resolved price for ${opts.psid || "(no psid)"} ` +
            `(allowed=[${allowedAmounts.join(", ")}], primary=${primaryQuoteAmount})`
        );
        text = clamp.text;
      }
    } catch (e) {
      console.error("⚠️ price clamp failed:", e.message);
    }
  }

  // 5. record the reply
  if (text) {
    history.push({ role: "assistant", text, nodeId: movedTo.id, at: new Date() });
  }

  const newState = {
    ...state,
    workflowId: String(workflow._id),
    nodeId: movedTo.id,
    history,
    vars,
    lead: ctx.lead,
    location: ctx.location,
    basket: state.basket || [],
    // Persist the ACTIVE measure's price so a follow-up turn that carries no
    // measure ("Porfa", "sí", "lo quiero") still quotes/clamps THAT measure —
    // not the promo/default. Without this the resolved 3x4 ($449) was lost and
    // state.priceInfo stayed the setup promo ($655), which then leaked.
    priceInfo: turnPriceInfo || state.priceInfo || null,
    // The active product (id) the customer is being quoted — carried so a
    // follow-up turn re-resolves THIS product's price from ML, not the promo.
    activeProductId: turnActiveProductId || null,
    // Remember the active size's color options so a later "¿otros colores?"
    // turn (which carries no measure) can still offer them.
    availableColors: turnColors || state.availableColors || null,
  };

  const diagnostics = {
    workflow: { id: String(workflow._id), name: workflow.name },
    fromNode: { id: currentNode.id, name: currentNode.name },
    toNode: { id: movedTo.id, name: movedTo.name },
    edgeId: decision.edgeId,
    routerReason: decision.reason,
    terminal: !!movedTo.terminal,
    toolCalls,
    actions: ctx.actions,
    handoffRequested: ctx.handoffRequested,
    handoffReason: ctx.handoffReason || null,
    catalogToSend: ctx.catalogToSend || null,
  };

  // 6. FLOW SWITCH — a TOOL (model-invoked) decided to hand off to another flow.
  // (The engine-side auto-detect in step 1.5 handles the common case; this covers
  // an explicit switch_flow tool call.)
  if (ctx.switchTo && ctx.switchTo.toWorkflowId && (opts._switchDepth || 0) < 2) {
    const handover = await performSwitch(ctx.switchTo, {
      history,
      vars,
      lead: ctx.lead,
      location: ctx.location,
      basket: newState.basket,
      opts,
      prefixReply: text, // include A's line before B's opening
    });
    if (handover) {
      return {
        reply: handover.reply,
        state: handover.state,
        diagnostics: { ...diagnostics, switchedTo: handover.switchedTo, afterSwitch: handover.diagnostics },
      };
    }
  }

  return { reply: text, state: newState, diagnostics };
}

// Detect whether the customer's message points at a product handled by ANOTHER
// active flow. Reuses check_product_scope's logic via a throwaway ctx; returns
// the switch target { toWorkflowId, toName, product } or null.
async function detectFlowSwitch(message, familyList, currentWorkflow) {
  // Gate: skip very short confirmations ("sí"/"ok"). check_product_scope now
  // uses an AI classifier (one cheap gpt-4o call) to decide product scope —
  // no keyword/regex matching — so attribute words like "beige" no longer
  // trigger false flow-switches.
  if (!message || message.trim().length < 3) return null;
  const { REGISTRY } = require("./tools");
  const probe = {
    actions: [],
    notes: [],
    handoffRequested: false,
    families: familyList,
    currentFlowName: currentWorkflow?.name || null,
    isColdStart: !!currentWorkflow?.isColdStart, // triage → always route out
    _autoProbe: true,
  };
  try {
    await REGISTRY.check_product_scope.execute({ query: message }, probe);
  } catch {
    return null;
  }
  const sr = probe.scopeResult;
  if (sr && sr.verdict === "other_flow" && sr.toWorkflowId && String(sr.toWorkflowId) !== String(currentWorkflow._id)) {
    return { toWorkflowId: sr.toWorkflowId, toName: sr.toName, product: sr.product };
  }
  return null;
}

// If the customer's message contains a measure (e.g. "4x3") that exists in this
// flow's families, resolve its price/link. Returns { name, priceInfo } or null.
// wantDims is the AI-extracted measure from the customer message (passed in so
// we don't re-extract); only fires for measure messages so plain "precio" keeps
// the preloaded one.
async function resolveInFamilyMeasure(message, familyList, wantDims) {
  const toolsMod = require("./tools");
  const isLengthOnly = (d) =>
    Array.isArray(d?.enabledDimensions) && d.enabledDimensions.length > 0 && !d.enabledDimensions.includes("width");

  let doc = null;
  if (wantDims) {
    // 2-D measure (W×L) — the normal case (malla confeccionada, etc.).
    doc = await toolsMod.findProductInFamilies(message, familyList, wantDims);
  } else {
    // No 2-D measure. For LENGTH-ONLY products (borde separador: you choose only
    // a length), a SINGLE length IS the measure — resolve it deterministically
    // ("18 metros" → Rollo de 18 m) instead of leaving the model to improvise/
    // escalate. Accept ONLY if the resolved product is genuinely length-only, so
    // a bare number in a 2-D flow doesn't quote half a measure.
    const direct = await toolsMod.findProductInFamilies(message, familyList, null);
    if (direct && isLengthOnly(direct)) doc = direct;
    if (!doc) {
      const nums = String(message).match(/\d+(?:\.\d+)?/g) || [];
      if (nums.length === 1) {
        const byNum = await toolsMod.findProductInFamilies(nums[0], familyList, null);
        if (byNum && isLengthOnly(byNum)) doc = byNum;
      }
    }
  }
  if (!doc) return null;
  const { resolvePrice } = require("./priceResolver");
  // Available color/variant options for this size (structural sibling walk).
  const variants = await toolsMod.availableVariantsForProduct(doc).catch(() => []);
  return { name: doc.name, id: String(doc._id), priceInfo: await resolvePrice(doc), variants };
}

// Carry the conversation over to flow B and run its opening turn. Shared by the
// engine auto-detect (step 1.5) and the explicit switch_flow tool (step 6).
async function performSwitch(switchTo, { history, vars, lead, location, basket, opts, prefixReply }) {
  const target = await loadWorkflowById(switchTo.toWorkflowId);
  if (!target) return null;
  const carried = { comesFromFlowSwitch: true };
  if (switchTo.product && switchTo.product.id) carried.products = [switchTo.product];

  // Re-run the customer's TRIGGERING message in the target flow so it resolves
  // and quotes the product/measure they asked for. If we opened with an empty
  // message, the target couldn't resolve the carried measure and would improvise
  // (e.g. wrongly say "6x8 no disponible"). Pull the last user message out of the
  // carried history (the target re-records it) and feed it as the opening turn.
  const hist = Array.isArray(history) ? [...history] : [];
  let openingMsg = "";
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i] && hist[i].role === "user") {
      openingMsg = String(hist[i].text || "");
      hist.splice(i, 1);
      break;
    }
  }

  const bState = {
    workflowId: String(target._id),
    nodeId: target.getStartNodeId(),
    history: hist, // carry the conversation (minus the triggering msg, re-added below)
    vars,
    setupOverrides: carried,
    lead,
    location,
    basket: basket || [],
    // contextBlock intentionally undefined → re-resolved for flow B
  };
  const bTurn = await runWorkflowTurn(target, bState, openingMsg, {
    ...opts,
    _switchDepth: (opts._switchDepth || 0) + 1,
    sandboxNoAutoSwitch: true, // don't let the target immediately switch again on the same message
  });
  const reply = [prefixReply, bTurn.reply].filter(Boolean).join("\n\n") || bTurn.reply || prefixReply || null;
  return {
    reply,
    state: bTurn.state,
    switchedTo: { id: String(target._id), name: target.name },
    diagnostics: bTurn.diagnostics,
  };
}

module.exports = { runWorkflowTurn, initState };
