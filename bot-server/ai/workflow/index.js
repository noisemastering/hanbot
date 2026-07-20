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
    .replace(/(\d),(\d)/g, "$1.$2") // Mexican decimal comma "3,5" → "3.5"
    .replace(/(\d)\s*(?:cms?\b|cent[ií]metros?\b|m\b|mts?\b|metros?\b)/g, "$1 ") // cm before m (borde height in cm)
    .replace(/\bcms?\.?\b|\bcent[ií]metros?\b|\bmts?\.?\b|\bmetros?\b|\bm\b/g, " ")
    .replace(/\bde\s+(?:largo|ancho|alto|altura|fondo|lado)\b/g, " ")
    .replace(/\b(?:largo|ancho|alto|altura|fondo)\s+de\b/g, " ");
  // Worded numbers ("tres por tres", "dos x dos") → digits, so the regex below
  // catches spelled-out measures too (the bot understands them like a human).
  cleaned = cleaned.replace(
    /\b(un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/g,
    (w) => String(_WORD_NUM[w] ?? w)
  );
  // Spelled/typo half-measures: "3 y medio", "3 imedio", "3 i medio", "tres y medio"
  // (→ "3 y medio" above) → "3.5". Mexican Spanish "y medio"/"imedio" = .5. Do this
  // AFTER worded→digit so "tres y medio" is handled too, and BEFORE the measure regex.
  cleaned = cleaned.replace(/(\d+)\s*(?:y\s*medi[oa]|i\s*medi[oa]|imedi[oa]|y\s*1\/2)\b/g, "$1.5");
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

// The client's roll-quote promo format: an "IVA incluido" header, one line per
// requested roll with "+ envío" (rolls are quoted with shipping separate — no
// online link), a mayoreo note, and the physical-store / nationwide-shipping
// line (exact wording the client asked for). rolls = [{ w, l, price }].
function rollPromoQuote(shade, rolls) {
  const money = (n) => "$" + Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const header = `Te comparto nuestras promociones en Malla Sombra Raschel ${shade ? shade + "% " : ""}(IVA incluido):`;
  const lines = rolls.map((r) => `Rollo de ${r.w} x ${r.l} m: ${money(r.price)} + envío`).join("\n");
  return (
    `${header}\n\n${lines}\n\n` +
    `📦 Contamos con descuentos especiales por compras al mayoreo.\n\n` +
    `🏢 Nuestra tienda física está ubicada en Querétaro pero enviamos a toda la república mexicana.`
  );
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

// The customer wants RAIN/WATERPROOF protection. Malla sombra is shade mesh — it
// is NOT impermeable (water passes through) — so we must never push it as a rain
// solution. ("para la lluvia", "impermeable", "que no pase el agua", "toldo")
function wantsWaterproof(text) {
  const t = String(text || "").toLowerCase();
  if (/\bimpermeable\b|a prueba de agua|water\s?proof|lona\s+impermeable|\btoldo\b/.test(t)) return true;
  if (/lluvi|llover|lluev|llovi/.test(t)) return true; // lluvia(s), llover, llueve/llueva, lloviendo/llovizna
  if (/que no (me )?(pase|entre|cale|traspase) (el )?agua/.test(t)) return true;
  return false;
}

// Reforzada (con refuerzo) families — cached. The sin-refuerzo flow uses these to
// look up + quote the reforzada version of a size it doesn't carry, so it can
// MENTION "esa medida la tengo en reforzada por $X" + link (no flow switch).
let _refFamCache = { at: 0, fams: null };
async function reforzadaFamilies() {
  if (_refFamCache.fams && Date.now() - _refFamCache.at < 30000) return _refFamCache.fams;
  const W = require("../../models/Workflow");
  let fams = [];
  try {
    const all = await W.find({ active: true }).select("name family families").lean();
    const rf = all.find((w) => /con\s*refuerzo/i.test(w.name || "") && !/sin\s*refuerzo/i.test(w.name || ""));
    fams = rf ? W.familyListOf(rf) || [] : [];
  } catch (e) {
    /* ignore */
  }
  _refFamCache = { at: Date.now(), fams };
  return fams;
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
      // Anchor the color-offer handler (and other product-aware steps) on the
      // preloaded/promo product from turn 1 — so "¿qué colores?" at first contact
      // resolves variants instead of falling to the model's "solo beige" answer.
      if (product && product._id && !state.activeProductId) state.activeProductId = String(product._id);
      state.priceInfo = priceInfo || null;
      state.catalog = catalog || null; // resolved catalog (climb): {url, kind, source}
      state.preloadedAmounts = preloadedAmounts || []; // every preloaded product's price (clamp allow-set)
      state.promoPitch = promoPitch || null; // verbatim sales pitch (sent once, on ask)
      state.promoQuote = promoQuote || null; // deterministic quote when no pitch is set
      // OPEN THE FILE ON ENGAGEMENT: entering a PRODUCT workflow (not cold-start) with a
      // message = the client asked about a valid product. Create/ensure the profile now
      // and record the product interest (POI) — even before any link or handoff. A file
      // that never goes further (no link, no purchase) is itself a useful telltale: an
      // engaged lead that didn't convert. Fire-and-forget.
      if (opts.psid && userMessage && !workflow.isColdStart && Array.isArray(familyList) && familyList.length) {
        const fam = familyList[0];
        const loc = require("../utils/locationStats");
        loc.ensureUserProfile(opts.psid, {}, "engagement")
          .then(() => loc.syncPOIToUser(opts.psid, {
            productInterest: (product && product.name) || workflow.name || null,
            familyId: fam && fam.id ? String(fam.id) : undefined,
            familyName: fam && fam.name ? fam.name : undefined,
          }))
          .catch(() => {});
      }
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

  // Rain/waterproof intent — gates the promo/default quotes and forces an honest
  // "malla sombra is not waterproof" clarification (it's shade mesh).
  const rainIntent = userMessage ? wantsWaterproof(String(userMessage)) : false;

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
      // Persist the completed lead (name + phone + zip/city) to the profile.
      if (opts.psid) {
        const nm = String((state.lead && state.lead.name) || "").trim().split(/\s+/).filter(Boolean);
        require("../utils/locationStats").ensureUserProfile(opts.psid, {
          first_name: nm[0] || undefined,
          last_name: nm.length > 1 ? nm.slice(1).join(" ") : undefined,
          phone: (state.lead && state.lead.phone) || undefined,
          zipcode: (state.location && (state.location.zipcode || state.location.zip)) || undefined,
          city: (state.location && state.location.city) || undefined,
        }, "handoff").catch(() => {});
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

  // BARE GREETING → a plain human greeting, NEVER a promo pitch. The model kept
  // dumping the promo (measure + price) on "buenas tardes" no matter how the prompt was
  // worded, because the promo context outweighs a soft instruction. A greeting is not a
  // buying signal, so handle it deterministically here — the classic "Hola, soy X, ¿en
  // qué te puedo ayudar?" — before the model ever sees it. Only fires when the message
  // is NOTHING but a greeting (a greeting + product/measure falls through to the flow).
  if (userMessage) {
    const _g = String(userMessage).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[!¡?¿.,]+/g, " ").replace(/\s+/g, " ").trim();
    if (/^(hola+|holi|ola|buenas|buen[oa]s?( (dias|tardes|noches))?|buen dia|que tal|que onda|que hubo|saludos|hey|hello)$/.test(_g)) {
      const greeted = Array.isArray(history) && history.some((h) => h.role === "assistant");
      const nm = opts.personaName;
      const reply = greeted
        ? `¡Hola de nuevo! 😊 ¿En qué te puedo ayudar?`
        : (nm ? `¡Hola! Soy ${nm} de Hanlob 😊 ¿En qué te puedo ayudar?` : `¡Hola! Gracias por escribir a Hanlob 😊 ¿En qué te puedo ayudar?`);
      history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
      return {
        reply,
        state: { ...state, history, nodeId: currentNode.id },
        diagnostics: {
          workflow: { id: String(workflow._id), name: workflow.name },
          fromNode: { id: currentNode.id, name: currentNode.name },
          toNode: { id: currentNode.id, name: currentNode.name },
          greeting: true,
        },
      };
    }
  }

  // Collect-before-handoff for the DETERMINISTIC early-return paths (steps 1.x)
  // that run BEFORE the post-node handoff gate. Mirrors that gate: if we already
  // have a reachable contact, complete the handoff now; otherwise ask for name +
  // phone — prefaced with any fact we owe the customer (a price quote, a sold-out
  // note) so one message both informs AND collects — and arm pendingHandoff so
  // their reply completes it next turn.
  const beginHandoff = ({ preface, reason } = {}) => {
    const pre = preface ? `${String(preface).trim()} ` : "";
    const haveContact = !!(state.lead && (state.lead.phone || state.lead.email || state.lead.name));
    if (haveContact) {
      // Persist the lead to the customer's profile at handoff — here we have MORE
      // than the zip (name + phone). Keyed by psid so correlation can use it later.
      if (opts.psid) {
        const nm = String(state.lead.name || "").trim().split(/\s+/).filter(Boolean);
        require("../utils/locationStats").ensureUserProfile(opts.psid, {
          first_name: nm[0] || undefined,
          last_name: nm.length > 1 ? nm.slice(1).join(" ") : undefined,
          phone: state.lead.phone || undefined,
          zipcode: (state.location && (state.location.zipcode || state.location.zip)) || undefined,
          city: (state.location && state.location.city) || undefined,
        }, "handoff").catch(() => {});
      }
      const who = state.lead.name ? `, ${String(state.lead.name).split(/\s+/)[0]}` : "";
      const reply = `${pre}¡Gracias${who}! 🙌 Un asesor te contactará lo antes posible para ayudarte.`;
      history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
      return {
        reply,
        state: { ...state, history, lead: state.lead || null, location: state.location || null, nodeId: currentNode.id, pendingHandoff: null },
        diagnostics: {
          workflow: { id: String(workflow._id), name: workflow.name },
          fromNode: { id: currentNode.id, name: currentNode.name },
          toNode: { id: currentNode.id, name: currentNode.name },
          handoffRequested: true,
          handoffReason: reason || null,
        },
      };
    }
    const reply = `${pre}¡Con gusto te paso con un asesor! 🙌 ¿Me compartes tu nombre y un teléfono para que te contacte?`;
    history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
    return {
      reply,
      state: { ...state, history, nodeId: currentNode.id, pendingHandoff: { reason: reason || null, attempts: 1 } },
      diagnostics: {
        workflow: { id: String(workflow._id), name: workflow.name },
        fromNode: { id: currentNode.id, name: currentNode.name },
        toNode: { id: currentNode.id, name: currentNode.name },
        handoffPendingContact: true,
      },
    };
  };

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

  // 1.055 PAYMENT / PAGO CONTRA ENTREGA. Fixed, known answer — but the LLM router
  // intermittently ESCALATES it to a human (and the grounding verifier only
  // sometimes rescues it). Answer it deterministically (matches the knowledge base)
  // so it NEVER hands off: purchase via Mercado Libre with compra protegida, paid at
  // order time; no cash-on-delivery except pickup at the Querétaro plant.
  if (userMessage) {
    const msgPay = String(userMessage).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    // Cash-on-delivery / pay-at-home, incl. "pagar a domicilio", "cuando llegue",
    // "al recogerlo", "se paga al recibir".
    const isContraEntrega =
      /contra\s*-?\s*entrega|contraentrega|pag\w*\s*(al\s*(recibir|entregar|recoger\w*|llegar)|a\s*domicilio|en\s*(domicilio|casa)|cuando\s*(llegue|me\s*llegue|lo\s*reciba))|cobr\w*\s*(al\s*(recibir|entregar)|a\s*domicilio)|se\s*paga\s*al\s*(recibir|entregar)|hasta\s*que\s*(me\s*)?(llegue|lo\s*reciba)/.test(msgPay);
    // Trust / scam concern (incl. typos like "eztafa") — same protected-purchase answer.
    const isTrustConcern =
      /e[sz]taf\w*|fraud\w*|\btim[oa]\b|enga[ñn]\w*|desconf\w*|no\s*(me\s*)?conf[ií]\w*|es\s*confiab\w*|no\s*es\s*confiab\w*|es\s*segur\w*|sera\s*segur\w*|me\s*da\s*(miedo|pendiente|cosa)|\bmiedo\b/.test(msgPay);
    const asksPayment =
      /(como|de que forma|de que manera|donde|cual)\b[^?.!]{0,25}\b(pago|pagar|se paga)\b/.test(msgPay) ||
      /forma de pago|metodo de pago|como se hace la compra|como es la compra|como se realiza la compra|como comprar|como se compra/.test(msgPay);
    if (isContraEntrega || asksPayment || isTrustConcern) {
      const leadIn = isTrustConcern && !isContraEntrega ? "Entiendo tu preocupación, tu compra está protegida. 🙌 " : "";
      const reply =
        leadIn +
        "La compra se realiza por Mercado Libre con compra protegida (si no llega o llega mal, te devuelven tu dinero) y el pago es al momento de ordenar en línea. No manejamos pago contra entrega, salvo que recojas directamente en nuestra planta en Querétaro. ¿Te comparto el link para completar tu compra? 😊";
      history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
      return {
        reply,
        state: { ...state, history, nodeId: currentNode.id },
        diagnostics: {
          workflow: { id: String(workflow._id), name: workflow.name },
          fromNode: { id: currentNode.id, name: currentNode.name },
          toNode: { id: currentNode.id, name: currentNode.name },
          paymentAnswered: true,
        },
      };
    }
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

  // 1.07–1.08 ROLLO-FLOW DETERMINISTIC HANDLING. The rollo flow has fixed shades
  // (35/50/70/80/90), discrete widths and lengths, so its quoting is enforced in
  // code rather than left to the model:
  //   (a) UNAVAILABLE SHADE — a % we don't carry → specialist handoff.
  //   (b) AREA CONFIRM — a non-standard W×L (e.g. 5x20) → confirm the m² it covers.
  //   (c) RECOMMEND — on confirm, propose the nearest-area real roll + price/link.
  //   (d) QUANTITY GATE — 2+ rolls = mayoreo → specialist handoff.
  //   (e) DECLINE — customer rejects the recommendation → specialist handoff.
  if (userMessage) {
    try {
      const Wf = require("../../models/Workflow");
      const rolloFams = Wf.familyListOf(workflow) || [];
      const isRollFlow = rolloFams.length > 0 && rolloFams.every((f) => /\brollo\b|ground\s*cover|antimaleza/i.test(f.name || ""));
      if (isRollFlow) {
        const { dimsOf, findProductInFamilies, nearestRollByArea, parseRollQuantity } = require("./tools");
        const { resolvePrice, trackedLink } = require("./priceResolver");
        const PF = require("../../models/ProductFamily");
        const msg = String(userMessage);
        // Accent-insensitive for yes/no detection: \b doesn't fit accented chars
        // (e.g. \bsí\b fails because "í" isn't a regex word-char), so normalize.
        const msgN = msg.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        const affirm = /\b(si|correcto|exacto|asi\s+es|claro|va|vale|sale|dale|de\s+acuerdo|ok|okay|perfecto|adelante|me\s+convence|esa)\b/.test(msgN);
        const decline = /\b(no|otra|otro|distint\w*|diferente|mejor\s+otra?|busco\s+otra|algo\s+mas|no\s+gracias)\b/.test(msgN);
        // Shades this rollo flow carries (e.g. 35/50/70/80/90).
        const carried = new Set();
        for (const f of rolloFams) for (const s of String(f.name || "").match(/\d{2,3}(?=\s*%)/g) || []) carried.add(s);
        // A shade the customer stated: "80%", "al 80", OR a BARE "80" — a bare number
        // counts only when the message has NO measure/length/quantity (so it's not a
        // size or a roll count). Catches "Buen día 80".
        const shadeInText = (t) => {
          const s = String(t || "");
          let mm = s.match(/(\d{2,3})\s*(?:%|por\s*ciento|porciento)/i);
          if (mm && carried.has(mm[1])) return mm[1];
          mm = s.match(/\b(?:al|del?|en|de)\s+(\d{2,3})\b/i);
          if (mm && carried.has(mm[1])) return mm[1];
          if (!/[x×]/i.test(s) && !/\b\d+\s*(?:m|mts?|metros?|largo|ancho)\b/i.test(s) && !/\b(?:rollos?|piezas?|unidades?|tramos?)\b/i.test(s)) {
            for (const n of s.match(/\b(\d{2,3})\b/g) || []) if (carried.has(n)) return n;
          }
          return null;
        };
        let askedShade = shadeInText(msg);
        // If we asked "¿qué % de sombra?" last turn, a bare number IS the answer, and
        // it applies to the measure we remembered then.
        let rememberedDims = null;
        if (state.awaitingRollShade) {
          const bn = (msg.match(/\b(\d{2,3})\b/) || [])[1];
          if (bn && carried.has(bn)) { askedShade = bn; rememberedDims = state.awaitingRollShade.dims; }
          state.awaitingRollShade = null;
        }
        // Persist an explicit shade so it carries across turns.
        if (askedShade && carried.has(askedShade)) state.rollShade = askedShade;
        let reqShade = askedShade || state.rollShade || null;
        // RULE: the shade must come from the USER — never guessed — EXCEPT a promo.
        // 1) A shade the client already said EARLIER in the conversation (e.g. "80" in
        //    the cold-start greeting, BEFORE switching to rollo — history carries over
        //    the switch). Don't re-ask what they already told us.
        if (!reqShade) {
          for (let i = history.length - 1; i >= 0 && i >= history.length - 10; i--) {
            if (history[i].role !== "user") continue;
            const hs = shadeInText(history[i].text);
            if (hs) { reqShade = hs; state.rollShade = hs; break; }
          }
        }
        // 2) A shaded rollo product PRELOADED by the ad → use its shade (promo inferred).
        if (!reqShade && state.product) {
          const PF = require("../../models/ProductFamily");
          let c = state.product;
          for (let i = 0; i < 8 && c; i++) {
            const sm = String(c.name || "").match(/(\d{2,3})\s*%/);
            if (sm && carried.has(sm[1])) { reqShade = sm[1]; break; }
            c = c.parentId ? await PF.findById(c.parentId).select("name parentId").lean().catch(() => null) : null;
          }
        }
        const dims = dimsOf(msg) || (extractAllMeasures(msg)[0] || null) || rememberedDims;
        // One-shot "awaiting quantity" flag: set when WE ask "¿cuántos?", so a
        // number reply ("3", "necesito 3", "tres") is read as the quantity next
        // turn. Consumed each turn; re-armed only when we ask again.
        const awaitingQty = !!state.awaitingRollQty;
        state.awaitingRollQty = false;
        let qty = parseRollQuantity(msg); // explicit "N rollos/piezas" — works anytime
        if (qty == null && awaitingQty && !dims && !askedShade) {
          const mm = msg.match(/\b(\d{1,3})\b/);
          const W = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
          const wm = msgN.match(/\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/);
          if (mm) qty = parseInt(mm[1], 10);
          else if (wm) qty = W[wm[1]];
        }

        const ret = (reply, extra) => {
          history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
          return {
            reply,
            state: { ...state, history, nodeId: currentNode.id },
            diagnostics: {
              workflow: { id: String(workflow._id), name: workflow.name },
              fromNode: { id: currentNode.id, name: currentNode.name },
              toNode: { id: currentNode.id, name: currentNode.name },
              ...extra,
            },
          };
        };
        const shadeText = async (leaf) => {
          let c = leaf;
          for (let i = 0; i < 8 && c; i++) {
            const m = String(c.name || "").match(/(\d{2,3})\s*%/);
            if (m) return m[1];
            c = c.parentId ? await PF.findById(c.parentId).select("name parentId").lean().catch(() => null) : null;
          }
          return null;
        };
        // Build a roll recommendation for a target area; quote it + share link, or
        // hand off if it has no price. Sets rollRecommendation/activeProductId.
        const recommend = async (area, shade) => {
          const rec = await nearestRollByArea(area, rolloFams, { shade: shade || undefined });
          if (!rec) return ret(`Déjame conectarte con un especialista para encontrar la mejor opción para cubrir ${area} m². 🙌`, { handoffRequested: true, handoffReason: `Sin rollo para ${area} m²` });
          const sh = await shadeText(rec.leaf);
          const pi = await resolvePrice(rec.leaf);
          state.pendingAreaConfirm = null;
          if (pi && pi.amount) {
            const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: rec.leaf.name, productId: String(rec.leaf._id) });
            state.activeProductId = String(rec.leaf._id);
            state.rollRecommendation = { id: String(rec.leaf._id), dims: rec.dims, area };
            const shadePart = sh ? `al ${sh}% ` : "";
            const reply = `Perfecto. Para eso te puedo recomendar un rollo ${shadePart}de ${rec.dims[0]} x ${rec.dims[1]} m, con un precio de $${pi.amount}.` + (link ? ` Te dejo el link: ${link}.` : "") + ` Dime si esta opción te convence. 😊`;
            return ret(reply, { rollAreaRecommended: `${rec.dims[0]}x${rec.dims[1]}` });
          }
          state.rollRecommendation = null;
          return ret(`Para cubrir ${area} m² te recomiendo un rollo de ${rec.dims[0]} x ${rec.dims[1]} m; te conecto con un especialista para confirmarte el precio y el envío. 🙌`, { handoffRequested: true, handoffReason: `Rollo recomendado ${rec.dims[0]}x${rec.dims[1]} sin precio en línea` });
        };

        // (a) UNAVAILABLE SHADE. Detect ANY %-shade the customer named — even one we
        // DON'T carry (shadeInText only returns CARRIED shades, so "75%" was invisible
        // and fell through to the model, which offered 70/80 instead of saying we don't
        // carry 75%). A %-anchored number that isn't in `carried` → say so + handoff.
        const rawShadeM = msgN.match(/(\d{2,3})\s*(?:%|por\s*ciento|porciento)/);
        const rawShade = rawShadeM ? rawShadeM[1] : null;
        const badShade = (askedShade && carried.size && !carried.has(askedShade)) ? askedShade
          : (rawShade && carried.size && !carried.has(rawShade)) ? rawShade : null;
        if (badShade) {
          return ret(
            `Por el momento no contamos con porcentaje de sombra al ${badShade}%; sin embargo, te comunico con un especialista para que pueda asesorarte mejor. Cuéntame, ¿a qué le quieres dar sombra? 😊`,
            { handoffRequested: true, handoffReason: `Cliente pidió % de sombra NO disponible (${badShade}%) en rollo — pasar con un especialista`, unavailableShade: badShade }
          );
        }
        if (askedShade) state.rollShade = askedShade;

        // (e) RECOMMENDATION pending → spec-change (new shade) / decline / accept
        if (state.rollRecommendation) {
          if (askedShade && !dims && qty == null) {
            // shade correction on the same area → re-recommend, NOT a decline
            return await recommend(state.rollRecommendation.area, askedShade);
          }
          if (decline && !affirm && !dims && qty == null) {
            state.rollRecommendation = null;
            return ret(`De acuerdo, un asesor se pondrá en contacto contigo para encontrar la mejor solución. 🙌`, { handoffRequested: true, handoffReason: `Cliente no aceptó el rollo recomendado — buscar mejor solución con un asesor` });
          }
          if (affirm && !dims && qty == null) state.rollRecommendation = null; // accepted → continue
        }

        // (b) AREA CONFIRM pending → on confirm, recommend
        if (state.pendingAreaConfirm) {
          if (affirm && !decline && !dims) return await recommend(state.pendingAreaConfirm.area, reqShade);
          if (!dims) state.pendingAreaConfirm = null; // unclear / changed → drop and continue
        }

        // (d) QUANTITY GATE — 2+ rolls = mayoreo → handoff
        let rollActive = !!state.activeProductId;
        if (!rollActive && dims) rollActive = !!(await findProductInFamilies(msg, rolloFams, dims));
        if (qty != null && qty >= 2 && rollActive) {
          return ret(`¡Excelente! Para ${qty} rollos manejamos precio de MAYOREO 🙌. Te paso con un especialista para darte el mejor precio y cerrar tu pedido.`, { handoffRequested: true, handoffReason: `Mayoreo: ${qty} rollos — precio y cierre con un especialista` });
        }

        // (c) MEASURE GIVEN
        if (dims) {
          // Resolve at the KNOWN shade (from state or this turn), not by raw msg
          // text — otherwise a bare "80" reply can't steer the resolver to the 80%
          // variant and it would pick an arbitrary shade.
          const resolveQ = reqShade ? `${reqShade}% ${dims[0]}x${dims[1]}` : msg;
          const exact = await findProductInFamilies(resolveQ, rolloFams, dims);
          const ed = exact ? dimsOf(exact.size) || dimsOf(exact.name) : null;
          const isExact = ed && ed[0] === dims[0] && ed[1] === dims[1];
          if (!isExact) {
            // Non-standard size → confirm the area it covers, then recommend.
            const area = dims[0] * dims[1];
            state.rollRecommendation = null;
            state.pendingAreaConfirm = { area, dims };
            return ret(`¡Un gusto atenderte! Veo que el área que buscas cubrir es de ${area} m², ¿correcto?`, { rollAreaConfirm: area });
          }
          // SIZE-SPECIFIC UNAVAILABLE SHADE: the customer named a shade we carry in
          // the flow (so it passed the global badShade gate) but NOT in THIS size —
          // findProductInFamilies soft-fell back to another shade, so `exact` is a
          // DIFFERENT %. Offer the shades we DO have in this size and say we don't
          // have the requested one, instead of silently quoting a different %.
          if (reqShade) {
            const actualSh = await shadeText(exact);
            if (actualSh && actualSh !== reqShade) {
              const avail = await require("./tools").availableShadesForMeasure(rolloFams, dims);
              if (avail.length && !avail.includes(reqShade)) {
                state.rollShade = null; // drop the unavailable shade so the next reply can re-pick
                state.awaitingRollShade = { dims };
                return ret(
                  `En el rollo de ${dims[0]} x ${dims[1]} m no manejamos ${reqShade}% de sombra; lo tenemos en ${avail.map((s) => s + "%").join(", ")}. ¿Cuál de esas te acomoda? 😊`,
                  { rollShadeUnavailableForSize: `${reqShade}%@${dims[0]}x${dims[1]}` }
                );
              }
            }
          }
          // EXACT size but the SHADE is unknown (shade-flow) → ASK the % FIRST, no
          // matter the quantity — NEVER guess a shade (a wrong % is "información
          // incorrecta"). Remember the measure so the next turn's shade reply quotes
          // it. Note "un rollo" parses as qty=1, so this must NOT gate on qty==null.
          if (carried.size > 0 && !reqShade) {
            const shades = [...carried].map(Number).sort((a, b) => a - b).join("%, ") + "%";
            state.awaitingRollShade = { dims };
            return ret(
              `¡Claro! Ese rollo de ${dims[0]} x ${dims[1]} m lo manejamos en varios porcentajes de sombra (${shades}). ¿Cuál necesitas? 😊`,
              { rollAskShade: true }
            );
          }
          // EXACT size we carry AND the shade is known → the ONLY thing left to
          // ask is the QUANTITY. Quote the price and ask how many; the link is
          // shared only once we know it's 1 roll (quantity gate: 1 → link, 2+ →
          // mayoreo handoff). Don't re-ask width/shade/area. qty already given
          // (==1, since 2+ was handled by the gate above) → fall through to quote.
          // Require a known shade ONLY when the flow has shades (Raschel rollo);
          // ground cover has none, so the exact size alone is enough to ask qty.
          const flowHasShades = carried.size > 0;
          if ((qty == null || qty === 1) && (reqShade || !flowHasShades)) {
            const pi = await resolvePrice(exact);
            if (pi && pi.amount) {
              const sh = await shadeText(exact);
              state.activeProductId = String(exact._id);
              // ROLL QUOTE — the client's promo format: IVA-incluido header, the
              // requested roll(s) with "+ envío" (rolls are quoted with shipping
              // separate, no online link), a mayoreo note, and the store line.
              return ret(
                rollPromoQuote(sh, [{ w: dims[0], l: dims[1], price: pi.amount }]),
                { rollQuoted: `${dims[0]}x${dims[1]}` }
              );
            }
          }
          // exact + no price → fall through; normal quoting handles it.
        }
      }
    } catch (err) {
      console.error("⚠️ rollo deterministic handling failed:", err.message);
    }
  }

  // 1.09 COMPLEMENTS-FLOW DETERMINISTIC HANDLING. These are NAMED SKUs (kit /
  // cordón / ojillos packets), NOT measure products — the generic measure-oriented
  // resolver can't match them by name, so we classify the message + resolve by the
  // known family IDs and quote live ML, instead of leaving the model to (fail to)
  // call a tool. Mapping: confeccionada → kit + cordón; rollo/GC → ojillos + cordón.
  if (userMessage && /Complementos de Instalaci/i.test(workflow.name || "")) {
    try {
      const C = require("./complementsResolver");
      const { resolvePrice, trackedLink } = require("./priceResolver");
      const PF = require("../../models/ProductFamily");
      const msg = String(userMessage);

      const net0 = C.classifyNet(msg);
      if (net0) state.complementNet = net0;
      const net = state.complementNet || null;
      const comp = C.classifyComplement(msg);

      const ret = (reply, extra) => {
        history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
        return {
          reply,
          state: { ...state, history, nodeId: currentNode.id },
          diagnostics: {
            workflow: { id: String(workflow._id), name: workflow.name },
            fromNode: { id: currentNode.id, name: currentNode.name },
            toNode: { id: currentNode.id, name: currentNode.name },
            ...extra,
          },
        };
      };
      const quote = async (doc, label) => {
        const pi = await resolvePrice(doc);
        if (pi && pi.amount && !pi.handoff) {
          const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: doc.name, productId: String(doc._id) });
          state.activeProductId = String(doc._id);
          return ret(`El ${label} cuesta $${pi.amount}.` + (link ? ` Aquí lo puedes comprar: ${link}` : "") + ` ¿Te ayudo con algo más? 😊`, { complementQuoted: label });
        }
        return ret(`Déjame conectarte con un especialista para confirmarte el precio del ${label}. 🙌`, { handoffRequested: true, handoffReason: `Complemento "${label}" sin precio en línea` });
      };

      // OJILLOS / SUJETADORES → resolve the packet by piece count
      const awaitingOj = !!state.awaitingOjillosQty;
      state.awaitingOjillosQty = false;
      if (comp === "ojillos" || (awaitingOj && /\d/.test(msg))) {
        let qty = C.parseOjillosQty(msg);
        if (qty == null && awaitingOj) { const mm = msg.match(/\b(\d{1,3})\b/); if (mm) qty = parseInt(mm[1], 10); }
        const packet = C.nearestPacket(qty);
        if (packet) {
          const doc = await C.resolveOjillosPacket(PF, packet);
          if (doc) return await quote(doc, `paquete de ${packet} ojillos sujetadores`);
        }
        const packets = await C.ojillosPackets(PF);
        state.awaitingOjillosQty = true;
        return ret(`Los ojillos sujetadores los manejamos por paquete (${packets.map((p) => p.n).join(", ")} piezas). ¿Cuántos necesitas? 😊`, { complementAskQty: true });
      }
      // KIT (confeccionada) and CORDÓN (universal) — single SKUs, quote directly.
      if (comp === "kit") {
        const doc = await C.resolveKit(PF);
        if (doc) return await quote(doc, "kit de instalación");
      }
      if (comp === "cordon") {
        const doc = await C.resolveCordon(PF);
        if (doc) return await quote(doc, "cordón con protección UV (rollo de 47 m)");
      }
      // No complement named yet, but we know the NET → recommend the mapped ones.
      if (!comp && net) {
        if (net === "confeccionada")
          return ret(`Para tu malla confeccionada te recomiendo el kit de instalación y el cordón con protección UV. ¿Cuál te cotizo? 😊`, { complementRecommend: "kit+cordon" });
        return ret(`Para ${net === "groundcover" ? "ground cover" : "tu rollo de malla"} te recomiendo los ojillos sujetadores y el cordón con protección UV. ¿Cuál te cotizo? 😊`, { complementRecommend: "ojillos+cordon" });
      }
      // else: nothing determinable yet (greeting / unclear) → fall through to graph.
    } catch (err) {
      console.error("⚠️ complements deterministic handling failed:", err.message);
    }
  }

  // 1.084 BORDE QUANTITY GATE. The borde flow (length-only rolls: 6/9/18/54 m) is
  // model-driven and shared the link immediately. User's rule: ASK how many rolls
  // BEFORE sharing the link (like rollo). Resolve the length → quote the unit price and
  // ask "¿cuántos?"; on the reply, 1 → link, 2+ → mayoreo handoff.
  try {
    const bordeFams = require("../../models/Workflow").familyListOf(workflow) || [];
    const isBordeFlow = /borde/i.test(workflow.name || "") || bordeFams.some((f) => /borde/i.test(f.name || ""));
    if (userMessage && isBordeFlow) {
      const { findProductInFamilies, parseRollQuantity } = require("./tools");
      const { resolvePrice, trackedLink } = require("./priceResolver");
      const PFm = require("../../models/ProductFamily");
      const msgB = String(userMessage);
      const retB = (reply, extra) => {
        history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
        return { reply, state: { ...state, history, nodeId: currentNode.id }, diagnostics: { workflow: { id: String(workflow._id), name: workflow.name }, fromNode: { id: currentNode.id, name: currentNode.name }, toNode: { id: currentNode.id, name: currentNode.name }, ...extra } };
      };
      const parseQty = () => {
        let q = parseRollQuantity(msgB);
        if (q == null) {
          const mm = msgB.match(/\b(\d{1,3})\b/);
          const W = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
          const wm = msgB.toLowerCase().match(/\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/);
          if (mm) q = parseInt(mm[1], 10); else if (wm) q = W[wm[1]];
        }
        return q;
      };
      const mayoreo = (n) => retB(`¡Excelente! Para ${n} rollos de borde manejamos precio de MAYOREO 🙌. Te paso con un especialista para darte el mejor precio y cerrar tu pedido.`, { handoffRequested: true, handoffReason: `Mayoreo borde: ${n} rollos` });
      const shareLink = async (leaf, len) => {
        const pi = await resolvePrice(leaf);
        if (!pi || !pi.amount) return null;
        const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: leaf.name, productId: String(leaf._id) });
        return retB(`¡Perfecto! El rollo de ${len} m está en $${pi.amount}.` + (link ? ` Aquí lo compras: ${link}` : ""), { bordeQuoted: len });
      };
      // 0) WIDTH/HEIGHT question. The borde separador is a FIXED 13 cm de alto (× the
      // length you pick) — it is NOT sold by width. The bot used to dodge this and keep
      // pushing the largo (reported: customer asked "cuánto mide de ancho" 3× and never
      // got 13 cm). Answer it FIRST, then continue: if they named a single length, quote
      // that roll; otherwise ask the largo. NOTE: "grueso/delgado" is the VARIANT, not a
      // width question — don't trip on it (we match alto/altura/ancho/grosor, not grueso).
      const asksBordeWidth = /\b(alto|altura|ancho|anchura|grosor|espesor)\b/i.test(msgB) || /qu[eé]\s+tan\s+(ancho|alto)/i.test(msgB);
      if (asksBordeWidth) {
        const width = "El borde separador mide 13 cm de alto (el largo lo eliges tú).";
        const noWxL0 = !/\d+\s*[x×*]\s*\d+/.test(msgB);
        const nums0 = [...new Set((msgB.replace(/\d+\s*[x×*]\s*\d+/g, " ").match(/\b\d{1,3}\b/g)) || [])];
        if (noWxL0 && nums0.length === 1) {
          const len = nums0[0];
          const leaf = await findProductInFamilies(msgB, bordeFams, null).catch(() => null);
          const ed = leaf && leaf.enabledDimensions;
          const exactLen = leaf && new RegExp(`\\b${len}\\b`).test(`${leaf.name || ""} ${leaf.size || ""}`);
          if (leaf && exactLen && Array.isArray(ed) && ed.length && !ed.includes("width")) {
            const pi = await resolvePrice(leaf).catch(() => null);
            if (pi && pi.amount) {
              state.activeProductId = String(leaf._id);
              state.awaitingBordeQty = { productId: String(leaf._id), length: len };
              return retB(`${width} El rollo de ${len} m está en $${pi.amount}. ¿Cuántos rollos necesitas? 😊`, { bordeWidthAnswered: true, bordeAskQty: len });
            }
          }
        }
        return retB(`${width} Lo manejo en rollos de 6, 9, 18 y 54 m. ¿Qué largo necesitas? 😊`, { bordeWidthAnswered: true, bordeAskLength: true });
      }
      // A) awaiting quantity from last turn (we asked "¿cuántos?")
      if (state.awaitingBordeQty) {
        const rec = state.awaitingBordeQty; state.awaitingBordeQty = null;
        const q = parseQty();
        if (q != null && q >= 2) return mayoreo(q);
        const leaf = await PFm.findById(rec.productId).lean().catch(() => null);
        const out = leaf ? await shareLink(leaf, rec.length) : null;
        if (out) return out;
      }
      // B) a new SINGLE, EXACT length (no W×L, exactly one length number) → resolve to a
      // LENGTH-ONLY borde product. Skip 2+ lengths (multi-length path quotes each) and
      // non-exact lengths like 57 (the closest-size path handles those).
      const hasWxL = /\d+\s*[x×*]\s*\d+/.test(msgB);
      const allNums = [...new Set((msgB.replace(/\d+\s*[x×*]\s*\d+/g, " ").match(/\b\d{1,3}\b/g)) || [])];
      if (!hasWxL && allNums.length === 1 && !state.awaitingBordeQty) {
        const len = allNums[0];
        // Resolve on the FULL message so "grueso/delgado" is respected (not just the length).
        const leaf = await findProductInFamilies(msgB, bordeFams, null).catch(() => null);
        const ed = leaf && leaf.enabledDimensions;
        const exactLen = leaf && new RegExp(`\\b${len}\\b`).test(`${leaf.name || ""} ${leaf.size || ""}`);
        if (leaf && exactLen && Array.isArray(ed) && ed.length && !ed.includes("width")) {
          const pi = await resolvePrice(leaf);
          if (pi && pi.amount) {
            state.activeProductId = String(leaf._id);
            const q = parseRollQuantity(msgB); // explicit "N rollos" only (the bare number IS the length here)
            if (q != null && q >= 2) return mayoreo(q);
            if (q === 1) return await shareLink(leaf, len);
            state.awaitingBordeQty = { productId: String(leaf._id), length: len };
            return retB(`¡Claro! El rollo de ${len} m está en $${pi.amount}. ¿Cuántos rollos necesitas? 😊`, { bordeAskQty: len });
          }
        }
      }
      // C) borde price/product inquiry with NO length yet → deterministically ASK the
      // length (6/9/18/54 m) instead of letting the model escalate to an asesor. The
      // model, under some setups (wholesale/manual), hands off on a bare "precio del
      // borde"; the human rule is: ask the length first, always.
      if (!hasWxL && allNums.length === 0 && !state.awaitingBordeQty) {
        const wantsBorde = /(precio|cuánto|cuanto|cotiz|cost|vale|borde|separador|rollo|metr|largo)/i.test(msgB);
        if (wantsBorde) {
          return retB(`¡Claro! Manejo el borde separador en rollos de 6, 9, 18 y 54 m. ¿Qué largo necesitas? 😊`, { bordeAskLength: true });
        }
      }
    }
  } catch (err) {
    console.error("⚠️ borde quantity gate failed:", err.message);
  }

  // 1.085 REFORZADA WHOLESALE QUANTITY GATE. When the customer names a quantity of
  // confeccionada pieces >= that product's wholesaleMinQty (lives on the SIZE-GROUP
  // ancestor, not the color leaf), it's a WHOLESALE order → recognize it and route
  // to an asesor, collecting name+phone (beginHandoff). Below the threshold it's
  // retail → fall through to the normal per-unit quote + link.
  if (userMessage && /con Refuerzo.*Retail/i.test(workflow.name || "")) {
    try {
      const { orderedQty, wantsWholesale, findProductInFamilies, dimsOf } = require("./tools");
      const { resolvePrice, trackedLink } = require("./priceResolver");
      const PF = require("../../models/ProductFamily");
      const refFams = require("../../models/Workflow").familyListOf(workflow) || [];
      const msg = String(userMessage);
      // EXPLICIT WHOLESALE REQUEST → asesor handoff for a volume quote, NO quantity
      // required. A human hearing "quiero precio de mayoreo" connects them to an advisor;
      // it never loops re-asking a size the customer already gave. (Was missing entirely:
      // wholesale only fired on a quantity threshold, so a bare "mayoreo" hit nothing.)
      if (wantsWholesale(msg)) {
        return beginHandoff({
          preface: `¡Claro! Para precio de MAYOREO por volumen te paso con un asesor que te dará la mejor cotización. 🙌`,
          reason: `Mayoreo (solicitud explícita de mayoreo)`,
        });
      }
      const dims = dimsOf(msg) || (extractAllMeasures(msg)[0] || null);
      // qty via orderedQty: EXPLICIT signal only (unit word / order verb + number). A
      // bare number here is a dimension or the fixed 90% shade — never a piece count. So
      // "6x3 al 90 por ciento" → null (no mayoreo); "quiero 90 piezas" → 90 (mayoreo).
      const qty = orderedQty(msg);
      if (qty && qty >= 2 && dims && refFams.length) {
        const leaf = await findProductInFamilies(msg, refFams, dims);
        if (leaf) {
          let wmq = null, c = leaf, i = 0;
          while (c && i++ < 8) {
            if (Number.isFinite(c.wholesaleMinQty) && c.wholesaleMinQty > 0) { wmq = c.wholesaleMinQty; break; }
            c = c.parentId ? await PF.findById(c.parentId).select("parentId wholesaleMinQty").lean().catch(() => null) : null;
          }
          const pi = await resolvePrice(leaf).catch(() => null);
          if (wmq && qty >= wmq) {
            const unit = pi && pi.amount ? ` (cada una $${pi.amount})` : "";
            return beginHandoff({
              preface: `¡Claro! ${qty} piezas de ${dims[0]}x${dims[1]} m${unit} entran en precio de MAYOREO 🙌; te preparo una cotización por volumen.`,
              reason: `Mayoreo confeccionada: ${qty} piezas de ${dims[0]}x${dims[1]} (umbral mayoreo ${wmq})`,
            });
          }
          // qty < threshold → retail: make the UNIT price clear + tell them to just set
          // the quantity at checkout (don't multiply, don't leave it ambiguous).
          if (pi && pi.amount) {
            const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: leaf.name, productId: String(leaf._id) });
            state.activeProductId = String(leaf._id);
            const colorTxt = String(leaf.name || "").replace(/^\s*color\s+/i, "").trim();
            const haveZip = !!(state.location && (state.location.zip || state.location.zipcode));
            const rr = `Claro, la ${dims[0]}x${dims[1]}${colorTxt ? " en " + colorTxt : ""} cuesta $${pi.amount}${pi.plusIva ? " + IVA" : ""} cada una (es precio por pieza). Para ${qty}, al comprar solo cambia la cantidad a ${qty} en el mismo enlace: ${link}`;
            history.push({ role: "assistant", text: rr, nodeId: currentNode.id, at: new Date() });
            return { reply: rr, state: { ...state, history, nodeId: currentNode.id, pendingZipAsk: haveZip ? (state.pendingZipAsk || false) : true }, diagnostics: { workflow: { id: String(workflow._id), name: workflow.name }, fromNode: { id: currentNode.id, name: currentNode.name }, toNode: { id: currentNode.id, name: currentNode.name }, retailQty: qty } };
          }
        }
      }
    } catch (err) {
      console.error("⚠️ reforzada wholesale gate failed:", err.message);
    }
  }

  // 1.0855 DEFERRED CP ASK — a link was shared last turn (pendingZipAsk armed). The CP
  // ask is mandatory but must land on THIS turn (once the client reacted to the link),
  // NOT on the same message as the link. Only fire if we still lack the zip, the client
  // isn't giving one now, and they aren't firing a NEW request (answer that instead — a
  // fresh link re-arms this). One-shot.
  if (userMessage && state.pendingZipAsk) {
    const haveZip = !!(state.location && (state.location.zip || state.location.zipcode));
    const msgHasZip = /\b\d{5}\b/.test(String(userMessage));
    const isNewRequest = /\b(colores?|verde|negro|negra|beige|blanc|gris|precio|cu[aá]nto|medida|link|enlace|comprar|otra|otro)\b/i.test(String(userMessage)) || !!require("./tools").dimsOf(String(userMessage)); // dimsOf → verbose "6 por 3" counts as a fresh request too, not just compact "6x3"
    state.pendingZipAsk = false; // one-shot regardless
    if (!haveZip && !msgHasZip && !isNewRequest) {
      const reply = "¡Con gusto! ¿Me compartes tu código postal? Es solo para fines estadísticos. 🙏";
      history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
      return {
        reply,
        state: { ...state, history, nodeId: currentNode.id },
        diagnostics: {
          workflow: { id: String(workflow._id), name: workflow.name },
          fromNode: { id: currentNode.id, name: currentNode.name },
          toNode: { id: currentNode.id, name: currentNode.name },
          deferredZipAsk: true,
        },
      };
    }
  }

  // 1.086 SIN-REFUERZO COLOR — sin refuerzo (con argollas) is BEIGE ONLY. A non-beige
  // color request must be answered IN-FLOW (don't route to handoff): quote stays
  // beige and we point to reforzada for other colors. Deterministic so a routing
  // edge can't escalate a simple color question.
  if (userMessage && /sin\s*refuerzo/i.test(workflow.name || "")) {
    try {
      const msgN = String(userMessage).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      const nonBeige = /\b(negro|negra|verde|gris|azul|rojo|blanco|caf[e]|marr[o]n|terracota|vino)\b/.test(msgN) && !/beige/.test(msgN);
      if (nonBeige) {
        const reply =
          `La malla sin refuerzo (con argollas) solo la manejo en BEIGE. 😊 ` +
          `Si buscas otro color como negro o verde, lo tengo en la malla REFORZADA. ` +
          `¿Te cotizo la medida que necesitas en beige sin refuerzo, o prefieres ver la reforzada?`;
        history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
        return {
          reply,
          state: { ...state, history, nodeId: currentNode.id },
          diagnostics: {
            workflow: { id: String(workflow._id), name: workflow.name },
            fromNode: { id: currentNode.id, name: currentNode.name },
            toNode: { id: currentNode.id, name: currentNode.name },
            sinRefuerzoBeigeOnly: true,
          },
        };
      }
    } catch (err) {
      console.error("⚠️ sin-refuerzo color handler failed:", err.message);
    }
  }

  // 1.0865 CONTACT-NUMBER REQUEST — the customer asks for OUR phone ("algún número",
  // "un teléfono", "a qué número marco", "su whatsapp"). SHARE our numbers directly —
  // never mistake it for "quiero hablar con un humano" and hand off asking for THEIR
  // contact (reported bug: "No compartió nuestros números antes del handoff").
  if (userMessage) {
    try {
      const msgP = String(userMessage).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      // Are they GIVING their own number (not asking for ours)? Skip if so.
      const givingOwn = /\bmi\b[^]*\b(numero|telefono|tel|whats?app?|whats|wasap|wpp)\b/.test(msgP) || /\d{10}/.test(msgP.replace(/\D/g, ""));
      const hasPhoneWord = /\btelefono\b|\btel\b|\bwhat?sapp?\b|\bwhats\b|\bwasap\b|\bwpp\b|\blada\b/.test(msgP);
      const numeroReq = /\bnumero\b/.test(msgP) && /\balgun|\bun\b|\buno\b|\bsu\b|\btu\b|\bel\b|\botro\b|\bdame\b|\bdas\b|\bpasa|\btiene|\bhay\b|\bcual\b|\ba que\b|\bpara\b|\bcontacto\b|\bmarcar\b|\bllamar\b|\bhablar\b|\bcomunicar|\bme das\b/.test(msgP);
      const isPhoneRequest = !givingOwn && (hasPhoneWord || numeroReq);
      if (isPhoneRequest) {
        const { getBusinessInfo } = require("../../businessInfoManager");
        const biz = await getBusinessInfo().catch(() => null);
        const phones = (biz && Array.isArray(biz.phones) ? biz.phones : []).filter(Boolean).slice(0, 2);
        if (phones.length) {
          const fmtPhone = (p) => {
            const d = String(p || "").replace(/\D/g, "").slice(-10);
            return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : String(p || "").trim();
          };
          const labels = ["Teléfono de tienda", "WhatsApp"];
          const lines = phones.map((p, i) => `${labels[i] || "Teléfono"}: ${fmtPhone(p)}`).join("\n");
          const reply = `¡Claro! Estos son nuestros datos de contacto:\n${lines}\n\nCon gusto te atendemos por cualquiera de los dos. 😊`;
          history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
          return {
            reply,
            state: { ...state, history, nodeId: currentNode.id },
            diagnostics: {
              workflow: { id: String(workflow._id), name: workflow.name },
              fromNode: { id: currentNode.id, name: currentNode.name },
              toNode: { id: currentNode.id, name: currentNode.name },
              sharedContactPhones: true,
            },
          };
        }
      }
    } catch (err) {
      console.error("⚠️ contact-number request handler failed:", err.message);
    }
  }

  // 1.087 COLOR OFFER — for flows whose products HAVE real color variants (reforzada
  // confeccionada: beige/negro/verde). "¿qué colores?" / "en verde/blanco" with NO
  // fresh measure → LIST the available colors for the active measure, each with its
  // OWN live price + tracked link. NEVER answer "solo beige" or hand off for a color
  // we stock (verde/negro ARE in stock). Bug (reported ×2): the promo-beige context
  // made the model say "la promo es solo beige" and escalate on verde.
  const colorAnchorId = state.activeProductId || (state.product && state.product._id) || null;
  if (userMessage && colorAnchorId && !/sin\s*refuerzo/i.test(workflow.name || "") && !/\brollo\b|ground\s*cover|antimaleza/i.test(workflow.name || "")) {
    try {
      const msgC = String(userMessage).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      const COLORW = /\b(beige|negro|negra|verde|blanc[oa]|gris|azul|rojo|caf[e]|marr[o]n|terracota|vino)\b/;
      const asksColor = /\bcolor(es)?\b/.test(msgC) || /de\s+qu[e]\s+color/.test(msgC) || /otro\s+color/.test(msgC) || COLORW.test(msgC);
      // A fresh measure this turn must go to the MEASURE path (it resolves the right
      // product AND its colors) — NOT get swallowed here and answered for the stale
      // anchor. dimsOf catches the VERBOSE form too ("6 por 3", "6 metros por 3"); the
      // old compact-only /\d+x\d+/ missed "6 por 3" → it silently swapped 6x3 for the
      // previous 6x4 anchor. (Reported: "6 por 3" answered as "la 6x4m".)
      const hasDims = !!require("./tools").dimsOf(msgC);
      if (asksColor && !hasDims) {
        const PF = require("../../models/ProductFamily");
        const { availableVariantsForProduct } = require("./tools");
        const { resolvePrice, trackedLink } = require("./priceResolver");
        const anchor = await PF.findById(colorAnchorId).lean().catch(() => null);
        const variants = anchor ? await availableVariantsForProduct(anchor).catch(() => []) : [];
        if (variants.length > 1) {
          const lineByColor = new Map(); // "beige" → "• Beige: $X → link"
          const colorMeta = new Map();   // "beige" → { id, amount, link, plusIva }
          for (const v of variants) {
            const leaf = await PF.findById(v.id).lean().catch(() => null);
            const pi = leaf ? await resolvePrice(leaf).catch(() => null) : null;
            if (pi && Number.isFinite(pi.amount) && pi.amount > 0 && !pi.soldOut) {
              const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: `${anchor.size || ""} ${v.label}`.trim(), productId: v.id });
              // If THIS color also carries a live discount, mention it (rebajado de $X).
              const disc = pi.hasDiscount && Number.isFinite(pi.originalPrice) && pi.originalPrice > pi.amount ? `, rebajado de $${Math.round(pi.originalPrice)}` : "";
              lineByColor.set(String(v.label).toLowerCase(), `• ${v.label}: $${pi.amount}${pi.plusIva ? " + IVA" : ""}${disc}${link ? ` → ${link}` : ""}`);
              colorMeta.set(String(v.label).toLowerCase(), { id: v.id, amount: pi.amount, link, plusIva: !!pi.plusIva });
            }
          }
          if (lineByColor.size) {
            const size = anchor.size || "esa medida";
            const cap = (c) => c.charAt(0).toUpperCase() + c.slice(1);
            // Colors the customer NAMED this turn (normalize spelling variants).
            const named = [...new Set((msgC.match(new RegExp(COLORW.source, "g")) || []).map((c) => c.replace("negra", "negro").replace(/blanc[oa]/, "blanco").replace(/caf[e]/, "cafe").replace(/marr[o]n/, "marron")))];
            const namedHave = named.filter((c) => lineByColor.has(c));
            const namedMissing = named.filter((c) => !lineByColor.has(c));
            // Quantity named this turn ("quiero 3 beige") — EXPLICIT signal only (unit
            // word / order verb + number). A bare number is a dimension or the fixed 90%
            // shade, never a piece count, so "al 90 por ciento" can't trip false mayoreo.
            const qtyC = require("./tools").orderedQty(msgC);
            const wholesaleThresholdFor = async (leafId) => {
              let wmq = null, c = await PF.findById(leafId).select("wholesaleMinQty parentId").lean().catch(() => null), i = 0;
              while (c && i++ < 8) {
                if (Number.isFinite(c.wholesaleMinQty) && c.wholesaleMinQty > 0) { wmq = c.wholesaleMinQty; break; }
                c = c.parentId ? await PF.findById(c.parentId).select("wholesaleMinQty parentId").lean().catch(() => null) : null;
              }
              return wmq;
            };
            let reply, definitiveLink = false;
            // The link IS the call to action — NEVER close with "¿te interesa?"/"¿te la
            // aparto?". The CP ask is mandatory but MUST come on the NEXT turn (once the
            // client reacts to the link), NOT stapled to the link message — so here we
            // only ARM it (pendingZipAsk) and the deferred step below asks it next turn.
            const haveZip = !!(state.location && (state.location.zip || state.location.zipcode));
            if (namedHave.length) {
              // Answer ONLY the color(s) asked (user: one color is enough, don't dump all 3).
              const preU = namedMissing.length ? `En ${namedMissing.map(cap).join(" y ")} no la manejamos, pero ` : ``;
              if (namedHave.length === 1) {
                const _c1 = namedHave[0];
                const _meta = colorMeta.get(_c1);
                if (qtyC && qtyC >= 2 && _meta) {
                  // A quantity was named. Wholesale threshold (on the size-group) → hand
                  // off for a volume quote; below it → retail: make the UNIT price clear
                  // and tell them to just set the quantity at checkout (same link).
                  const _wmq = await wholesaleThresholdFor(_meta.id);
                  if (_wmq && qtyC >= _wmq) {
                    return beginHandoff({
                      preface: `¡Claro! ${qtyC} piezas de ${size} en ${cap(_c1)} (cada una $${_meta.amount}) entran en precio de MAYOREO 🙌; te preparo una cotización por volumen.`,
                      reason: `Mayoreo confeccionada: ${qtyC} piezas ${size} ${_c1}`,
                    });
                  }
                  reply = `${preU}la ${size} en ${cap(_c1)} cuesta $${_meta.amount}${_meta.plusIva ? " + IVA" : ""} cada una (es precio por pieza). Para ${qtyC}, al comprar solo cambia la cantidad a ${qtyC} en el mismo enlace: ${_meta.link}`;
                  definitiveLink = true;
                } else {
                  reply = `${preU}sí, la ${size} en ${cap(_c1)}:\n${lineByColor.get(_c1)}`;
                  definitiveLink = true; // one color, one link → arm the deferred CP ask
                }
              } else {
                reply = `${preU}la ${size} la tenemos en:\n${namedHave.map((c) => lineByColor.get(c)).join("\n")}\n¿Cuál prefieres? 😊`;
              }
            } else if (namedMissing.length) {
              // Only a color we DON'T carry was named → say so + list what we have.
              reply = `Ese color no lo manejamos, pero la ${size} la tenemos en:\n${[...lineByColor.values()].join("\n")}\n¿Cuál prefieres? 😊`;
            } else {
              // General "¿qué colores?" (no specific color named) → list all available.
              reply = `la ${size} la tenemos en:\n${[...lineByColor.values()].join("\n")}\n¿Cuál prefieres? 😊`;
            }
            history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
            return {
              reply,
              state: { ...state, history, nodeId: currentNode.id, pendingZipAsk: (definitiveLink && !haveZip) ? true : (state.pendingZipAsk || false) },
              diagnostics: {
                workflow: { id: String(workflow._id), name: workflow.name },
                fromNode: { id: currentNode.id, name: currentNode.name },
                toNode: { id: currentNode.id, name: currentNode.name },
                colorOffer: lineByColor.size,
              },
            };
          }
        }
      }
    } catch (err) {
      console.error("⚠️ color-offer handler failed:", err.message);
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
  if (userMessage && !state.purchased && !rainIntent && (state.promoPitch || state.promoQuote) && (!state.promoPitchSent || state.promoDismissed)) {
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
    !rainIntent &&
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
          if (pi && pi.soldOut) {
            // Active but out of stock → acknowledge AND hand off (capture the lead
            // so a human follows up / notifies when it returns).
            return beginHandoff({
              preface: `¡Claro que la manejamos! Pero por el momento está agotada 😕.`,
              reason: pi.handoffReason || `Producto AGOTADO: ${doc.name}`,
            });
          }
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
            // Price but NO purchase link → quote it AND hand off to close the sale.
            if (pi.quoteThenHandoff || (pi.handoff && !link)) {
              const nm = doc.size || doc.name;
              return beginHandoff({
                preface: `¡Claro! La malla de ${nm} tiene un precio de $${amount}${plusIva ? " + IVA" : ""}.`,
                reason: pi.handoffReason || `Sin link de compra: ${doc.name}`,
              });
            }
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
  // The sin-refuerzo flow self-manages measures (sin sizes → quote; missing sizes
  // → MENTION reforzada + link, never switch), so the measure router is skipped
  // while inside it.
  const inSinRefuerzo = /sin\s*refuerzo/i.test(workflow.name || "");
  // The ROLLO flow likewise self-manages roll measures. A roll W×L (e.g. 2x10)
  // also exists as a confeccionada piece, so the cross-flow router would bounce a
  // roll customer to a "¿reforzada o rollo?" clarify — wrong when they're already
  // in the rollo flow asking for a roll. Skip the router here; step 1.6 resolves
  // the roll within the flow.
  const isRollFlow = familyList.length > 0 && familyList.every((f) => /\brollo\b|ground\s*cover|antimaleza/i.test(f.name || ""));
  if (userMessage && !inSinRefuerzo && !isRollFlow && (opts._switchDepth || 0) < 2 && !opts.sandboxNoAutoSwitch) {
    try {
      const { dimsOf } = require("./tools");
      const earlyDims = dimsOf(String(userMessage)) || extractAllMeasures(String(userMessage))[0] || null;
      if (earlyDims) {
        const { routeByMeasure, buildClarifyQuestion } = require("./measureRouter");
        const r = await routeByMeasure(String(userMessage), earlyDims, String(workflow._id), { isColdStart: !!workflow.isColdStart });
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
  // When a handoff fires this turn but we still owe the customer a fact (a price
  // quote, a "sold out" acknowledgement), this preface is prepended to the
  // collect-before-handoff ask so the same message both informs them AND asks for
  // their contact (instead of swallowing the quote with a generic ask).
  let turnHandoffPreface = null;
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
  // When the turn quoted a measure NOT in catalog and offered the nearest size
  // instead, the reply legitimately names a DIFFERENT measure → don't clamp it.
  let usedClosestMeasure = false;
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
  // ALREADY-STATED SHADE %: the rollo deterministic handler persists state.rollShade
  // when the customer states/implies a shade (incl. a bare "80" or one said earlier
  // in the conversation). Tell the model so the descubrir node asks for the LARGO/
  // ÁREA and NEVER re-asks the % the customer already gave.
  {
    const isRoll = (require("../../models/Workflow").familyListOf(workflow) || []).some((f) => /\brollo\b|ground\s*cover|antimaleza/i.test(f.name || ""));
    if (isRoll && state.rollShade) {
      turnContextExtra += `\n- EL CLIENTE YA INDICÓ ${state.rollShade}% DE SOMBRA — NO se lo vuelvas a preguntar. Continúa pidiéndole el LARGO que necesita o el ÁREA a cubrir.`;
    }
  }
  // ALREADY-CAPTURED LOCATION: if we already have the customer's CP/city, tell the
  // model so it NEVER asks for it again (it was re-asking 2–3× because the captured
  // zip lived in state but never reached the node prompt).
  {
    const knownZip = state.location && (state.location.zip || state.location.zipcode);
    const knownCity = state.location && state.location.city;
    if (knownZip || knownCity) {
      turnContextExtra +=
        `\n- DATO YA CAPTURADO (NO lo vuelvas a pedir): ya tienes ${knownZip ? `el código postal del cliente (${knownZip})` : ""}` +
        `${knownZip && knownCity ? " y " : ""}${knownCity ? `su ciudad (${knownCity})` : ""}. ` +
        `Úsalo para el envío/cotización; NUNCA le pidas de nuevo el código postal ni la ciudad.`;
    }
  }
  // RAIN/WATERPROOF: never sell malla sombra as a rain solution — it's shade mesh.
  if (rainIntent) {
    turnContextExtra +=
      `\n- LLUVIA / IMPERMEABLE: el cliente menciona lluvia o algo impermeable. La malla sombra da SOMBRA y reduce el calor, pero NO es impermeable: deja pasar el agua y NO detiene la lluvia. ` +
      `Acláraselo con HONESTIDAD; NO la ofrezcas ni la cotices como solución para la lluvia, y NO le mandes el link de compra para ese fin. Hanlob NO vende lonas impermeables ni toldos. ` +
      `Pregúntale si le sirve para dar sombra / reducir el calor (que es para lo que sí funciona).`;
  }
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
        const customerLines = []; // clean, customer-facing (used as the handoff preface if we escalate)
        let resolvedAny = false;
        let multiNeedsHandoff = false;
        for (const d of allMeasures) {
          const tag = `${d[0]}x${d[1]}m`;
          const doc = await findProductInFamilies(String(userMessage), familyList, d);
          if (!doc) {
            lines.push(`  • ${tag}: no es medida estándar — ofrécele la más cercana o pásalo con un asesor.`);
            continue;
          }
          const pi = await resolvePrice(doc);
          if (pi && pi.soldOut) {
            // Active but out of stock → note it AND escalate (capture the lead).
            lines.push(`  • ${tag}: SÍ la manejamos pero está AGOTADA por ahora — NO compartas link; el sistema la pasará con un asesor.`);
            customerLines.push(`• ${tag}: la manejamos, pero por ahora está agotada.`);
            multiNeedsHandoff = true;
            turnHandoffReason = turnHandoffReason || `Producto AGOTADO ${tag}: ${pi.handoffReason || "sin stock — pasar con un asesor"}`;
          } else if (pi && pi.amount) {
            resolvedAny = true;
            turnActiveProductId = String(doc._id);
            noteAmount(pi, false); // each price is allowed; no single primary in a multi-quote
            const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: doc.name, productId: String(doc._id) });
            lines.push(`  • ${tag}: $${pi.amount}${pi.plusIva ? " + IVA" : ""}${link ? ` → ${link}` : ""}`);
            customerLines.push(`• ${tag}: $${pi.amount}${pi.plusIva ? " + IVA" : ""}${link ? ` → ${link}` : ""}`);
            // Price but NO purchase link → still quote it, but escalate to close.
            if (pi.quoteThenHandoff || (pi.handoff && !link)) {
              multiNeedsHandoff = true;
              turnHandoffReason = turnHandoffReason || `Cotización ${tag}: ${pi.handoffReason || "sin link de compra — concretar con un asesor"}`;
            }
          } else if (pi && pi.handoff) {
            lines.push(`  • ${tag}: sin precio confirmado — el sistema la pasará con un asesor para el precio.`);
            customerLines.push(`• ${tag}: el precio te lo confirma un asesor.`);
            multiNeedsHandoff = true;
            turnHandoffReason = turnHandoffReason || `Cotización ${tag}: ${pi.handoffReason || "validar precio con un asesor"}`;
          }
        }
        if (resolvedAny) {
          askedMeasureResolved = true;
          const pinnedId = state.product && state.product._id ? String(state.product._id) : null;
          if (!pinnedId || turnActiveProductId !== pinnedId) state.promoDismissed = true;
        }
        turnContextExtra +=
          `\n- COTIZACIÓN MÚLTIPLE: el cliente pidió varias medidas en un mismo mensaje. Cotiza CADA una con SU PROPIO precio y SU PROPIO link (una línea por medida); NUNCA uses el mismo precio o link para dos medidas distintas:\n${lines.join("\n")}`;
        // If any measure needs a human (sold out / no link / no price), escalate —
        // but keep the resolved quotes by prefacing the handoff ask with them.
        if (multiNeedsHandoff && customerLines.length) {
          turnHandoffPreface = `Te paso lo que tengo:\n${customerLines.join("\n")}`;
        }
        multiHandled = true;
      }

      // MULTI-LENGTH (length-only products like borde: "9 y 18 m", "9, 18 y 54").
      // extractAllMeasures only finds W×L PAIRS, so a list of bare lengths never
      // multi-quotes and the model quoted just one. Resolve each number to a
      // length-only leaf and quote each. Only fires for length-only products
      // (borde/cinta) — numbers that don't resolve to one are ignored, so W×L
      // flows (reforzada/rollo) never misfire here.
      if (!multiHandled) {
        const { stripMeasures } = require("./tools");
        const noPairs = stripMeasures(userMessage) // drops W×L pairs incl. verbose "9 metros por 18m"
          .replace(/\d+\s*%/g, " "); // drop shade %
        const nums = [...new Set((noPairs.match(/\d+(?:\.\d+)?/g) || []).map(Number))];
        if (nums.length >= 2) {
          const { findProductInFamilies } = require("./tools");
          const { resolvePrice, trackedLink } = require("./priceResolver");
          const hits = [];
          for (const n of nums) {
            const doc = await findProductInFamilies(`${n} m`, familyList);
            const ed = doc && doc.enabledDimensions;
            if (doc && Array.isArray(ed) && ed.length > 0 && !ed.includes("width")) hits.push({ n, doc });
          }
          if (hits.length >= 2) {
            turnPriceInfo = null;
            const lines = [], customerLines = [];
            let needHandoff = false;
            for (const { n, doc } of hits) {
              const pi = await resolvePrice(doc);
              if (pi && pi.amount) {
                noteAmount(pi, false);
                const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: doc.name, productId: String(doc._id) });
                if (pi.quoteThenHandoff || (pi.handoff && !link)) { needHandoff = true; turnHandoffReason = turnHandoffReason || `Cotización ${n} m: sin link — concretar con un asesor`; }
                lines.push(`  • ${n} m: $${pi.amount}${pi.plusIva ? " + IVA" : ""}${link ? ` → ${link}` : ""}`);
                customerLines.push(`• ${n} m: $${pi.amount}${pi.plusIva ? " + IVA" : ""}${link ? ` → ${link}` : ""}`);
              } else if (pi && pi.soldOut) {
                needHandoff = true; turnHandoffReason = turnHandoffReason || `AGOTADO ${n} m — pasar con un asesor`;
                lines.push(`  • ${n} m: SÍ lo manejamos pero está AGOTADO — el sistema pasará con un asesor.`);
                customerLines.push(`• ${n} m: lo manejamos, pero por ahora está agotado.`);
              } else {
                needHandoff = true; turnHandoffReason = turnHandoffReason || `Cotización ${n} m — validar con un asesor`;
                lines.push(`  • ${n} m: el precio lo confirma un asesor.`);
                customerLines.push(`• ${n} m: el precio te lo confirma un asesor.`);
              }
            }
            turnContextExtra += `\n- COTIZACIÓN MÚLTIPLE (varios largos): el cliente pidió varios largos en un mensaje; cotiza CADA largo con SU PROPIO precio y SU PROPIO link (una línea por largo); NUNCA omitas ninguno:\n${lines.join("\n")}`;
            if (needHandoff && customerLines.length) turnHandoffPreface = `Te paso lo que tengo:\n${customerLines.join("\n")}`;
            askedMeasureResolved = true;
            multiHandled = true;
          }
        }
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
        if (pi.soldOut) {
          // Active but out of stock → acknowledge AND hand off (capture the lead
          // so a human follows up / notifies when it returns).
          const askedMeasure = wantDims ? `${wantDims[0]}x${wantDims[1]}m` : found.name;
          turnHandoffReason = `Producto AGOTADO ${askedMeasure}: ${pi.handoffReason || "sin stock — pasar con un asesor"}`;
          turnHandoffPreface = `Sí manejamos la medida ${askedMeasure}, pero por el momento está agotada.`;
          turnContextExtra =
            `\n- PRODUCTO AGOTADO + HANDOFF: la medida ${askedMeasure} está AGOTADA; el sistema la pasará con un asesor para darle seguimiento. ` +
            `Acláralo con naturalidad; NO compartas link ni la cotices para comprar; NUNCA digas que no la vendemos.`;
        } else if (pi.quoteThenHandoff) {
          // Price resolved but NO purchase link → quote it AND hand off to close.
          // No link ⇒ NOT a Mercado Libre listing with free shipping baked in, so
          // the price does NOT include shipping: the quote must say "+ envío".
          const askedMeasure = wantDims ? `${wantDims[0]}x${wantDims[1]}m` : found.name;
          turnHandoffReason = `Cotización ${askedMeasure}: ${pi.handoffReason || "sin link de compra — concretar con un asesor"}`;
          turnHandoffPreface = `La medida ${askedMeasure} tiene un precio de $${pi.amount}${pi.plusIva ? " + IVA" : ""} + envío.`;
          turnContextExtra =
            `\n- COTIZA + HANDOFF: la medida ${askedMeasure} cuesta $${pi.amount}${pi.plusIva ? " + IVA" : ""} pero NO tiene link de compra en línea; ` +
            `este precio NO incluye envío, así que dilo SIEMPRE como "$${pi.amount}${pi.plusIva ? " + IVA" : ""} + envío" (más el costo de envío). ` +
            `El sistema la pasará con un asesor para concretar. Dile el PRECIO + envío y que un asesor le ayuda a concretar la compra; NO inventes un link.`;
        } else if (pi.handoff) {
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
          const disc =
            pi.hasDiscount && Number.isFinite(pi.originalPrice) && pi.originalPrice > pi.amount
              ? ` CON DESCUENTO (rebajado de $${Math.round(pi.originalPrice)} a $${pi.amount})`
              : "";
          // No link ⇒ not an ML listing (free shipping baked in), so the price does
          // NOT include shipping → must be quoted as "+ envío".
          const shipNote = !link
            ? ` Este precio NO incluye envío: al cotizar dilo SIEMPRE como "$${pi.amount}${pi.plusIva ? " + IVA" : ""} + envío" (más el costo de envío).`
            : "";
          // The customer asked for a shade % we don't stock in this size → clarify.
          const sm = found.shadeMismatch;
          const shadeNote = sm
            ? `\n- ACLARA LA SOMBRA (obligatorio): el cliente pidió ${sm.requested}%, pero en la medida ${wantDims ? `${wantDims[0]}x${wantDims[1]} m` : "esa"} NO manejamos ${sm.requested}%. Lo que le vas a ofrecer es ${sm.actual}%${sm.available && sm.available.length ? ` (disponibles en esa medida: ${sm.available.map((s) => s + "%").join(", ")})` : ""}. DILE con naturalidad que en esa medida no tenemos ${sm.requested}% y ofrécele la de ${sm.actual}% (o las opciones disponibles) — NUNCA la cotices como si fuera ${sm.requested}%.`
            : "";
          turnContextExtra =
            `\n- COTIZACIÓN SOLICITADA AHORA: el cliente pregunta por "${found.name}". Precio $${pi.amount}${pi.plusIva ? " + IVA" : ""}${disc}${pi.source === "ml" ? " (Mercado Libre)" : " (inventario)"}.` +
            (link ? ` Link: ${link}.` : "") +
            (pi.plusIva ? ` Este precio es MÁS IVA: al cotizar di SIEMPRE "$${pi.amount} + IVA" o "más IVA".` : "") +
            shipNote +
            ` SIEMPRE dile el PRECIO CONCRETO ($${pi.amount})${disc ? ` y que está REBAJADO desde $${Math.round(pi.originalPrice)}` : ""}` +
            (link ? ` y COMPARTE el link en este mismo mensaje.` : ` (no hay link de compra en línea para esta opción; NO inventes uno).`) +
            ` NUNCA respondas solo "con descuento" ni "¿te interesa?" sin dar el precio exacto${link ? " y el enlace" : ""}. NO ${link ? "escales a un humano ni " : ""}pidas la medida de nuevo.` +
            ` ESTA MEDIDA SÍ EXISTE EXACTA en catálogo (ya la resolví): cotízala DIRECTO. PROHIBIDO decir "te paso la opción más cercana", "la más cercana", "sobre medida", "a la medida", "medida exacta", "te apoyo con un asesor para cotizarla" o cualquier hedge que sugiera que NO la tenemos${link ? "" : " o que se necesita un asesor"} — la tenemos exacta a $${pi.amount}${link ? " con su link" : ""}.` +
            shadeNote;
          // QUANTITY: the customer named N pieces. If we're here, N is BELOW the
          // mayoreo threshold (step 1.085 already routed 2+ ≥ wholesaleMinQty to
          // mayoreo), so quote it as retail — but ACKNOWLEDGE the quantity and give
          // the TOTAL (the bot used to answer a bare unit price, ignoring "2 piezas").
          const askedQty = require("./tools").parseRollQuantity(String(userMessage));
          if (askedQty && askedQty >= 2 && Number.isFinite(pi.amount)) {
            const total = pi.amount * askedQty;
            allowedAmounts.push(total); // whitelist the total so the price clamp doesn't rewrite it to the unit price
            turnContextExtra +=
              `\n- CANTIDAD: el cliente quiere ${askedQty} piezas de ${found.name}. Cada una $${pi.amount}${pi.plusIva ? " + IVA" : ""}; ` +
              `el TOTAL por ${askedQty} piezas es $${total}${pi.plusIva ? " + IVA" : ""}. Dile el total y comparte el link (en Mercado Libre elige la cantidad ${askedQty}).`;
          }
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
        const toolsMod = require("./tools");

        // OUT-OF-BOUNDS MEASURE → LIKELY A DROPPED DECIMAL. Confeccionada tops
        // out around 15 m, so a value like 250 almost certainly means 2.5 (the
        // "." fell out, or cm were typed). In an AREA flow (rolls are excluded —
        // a long length there is legit and gets composed elsewhere), if a
        // dimension is absurdly large AND ÷100 lands it back in a plausible malla
        // range, ASK the customer to confirm the corrected measure BEFORE quoting
        // — never quote the 250, never say "no manejamos decimales". This fixed
        // the "4x250 → 'como lleva decimal'" hallucination.
        let oobHandled = false;
        if (!isRollFlow) {
          const OOB_MAX = 20;                              // beyond any real confeccionada (max ~15 m)
          const plausible = (v) => v >= 1.5 && v <= 16;    // a real malla side
          const corrected = wantDims.map((v) => (v > OOB_MAX && plausible(v / 100) ? v / 100 : v));
          const anyFixed = corrected.some((v, i) => v !== wantDims[i]);
          const stillOOB = corrected.some((v) => v > OOB_MAX); // couldn't sensibly fix (e.g. 5000 → 50)
          if (anyFixed && !stillOOB) {
            const ca = corrected.slice().sort((a, b) => a - b);
            turnContextExtra +=
              `\n- MEDIDA CON DÍGITO DE MÁS (probable): el cliente escribió ${wantDims[0]}x${wantDims[1]} m, ` +
              `pero la medida máxima real es ~15 m, así que casi seguro se le coló un dígito y quiso ${ca[0]}x${ca[1]} m. ` +
              `PREGÚNTALE si su medida es ${ca[0]}x${ca[1]} m antes de cotizar. NO cotices ${wantDims[0]}x${wantDims[1]} m, ` +
              `NO inventes precio y NUNCA digas "no manejamos decimales". Si te confirma, en el siguiente mensaje la cotizas.`;
            oobHandled = true;
          }
        }

        // SIN-REFUERZO: our catalog is shorter. If the size isn't here, DON'T
        // switch flows — just MENTION it's available in REFORZADA and offer that
        // link (reforzada is the pricier, reinforced option).
        let mentionedReforzada = false;
        if (!oobHandled && inSinRefuerzo) {
          try {
            const { resolvePrice, trackedLink } = require("./priceResolver");
            const refFams = await reforzadaFamilies();
            const refLeaf = refFams.length ? await toolsMod.findProductInFamilies(String(userMessage), refFams, wantDims) : null;
            if (refLeaf) {
              const pi = await resolvePrice(refLeaf);
              if (pi && pi.amount && !pi.soldOut) {
                const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: refLeaf.name, productId: String(refLeaf._id) });
                // DETERMINISTIC — the model kept dropping the "not in sin refuerzo"
                // clause and just quoting the reforzada price. Return the framed reply.
                const disc = pi.hasDiscount && Number.isFinite(pi.originalPrice) && pi.originalPrice > pi.amount ? `, rebajado de $${Math.round(pi.originalPrice)}` : "";
                const reply =
                  `Esa medida ${wantDims[0]}x${wantDims[1]} m NO la manejo SIN refuerzo (con argollas), ` +
                  `pero SÍ la tengo en REFORZADA (con refuerzo en las esquinas): $${pi.amount}${disc}.` +
                  (link ? ` Aquí la puedes comprar: ${link}` : "");
                history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
                return {
                  reply,
                  state: { ...state, history, nodeId: currentNode.id },
                  diagnostics: {
                    workflow: { id: String(workflow._id), name: workflow.name },
                    fromNode: { id: currentNode.id, name: currentNode.name },
                    toNode: { id: currentNode.id, name: currentNode.name },
                    sinRefuerzoMentionReforzada: `${wantDims[0]}x${wantDims[1]}`,
                  },
                };
              }
            }
          } catch (err) {
            console.error("⚠️ sin→reforzada mention failed:", err.message);
          }
        }
        // The customer named a MEASURE we couldn't resolve in catalog (e.g.
        // 13x3 — out of range). Find the closest available size so the bot
        // offers a REAL size and asks if they still want the exact one —
        // instead of inventing a size or saying "no manejamos decimales".
        const closest = (oobHandled || mentionedReforzada) ? null : await toolsMod.closestAvailableMeasure(String(userMessage), familyList, wantDims);
        if (closest) {
          usedClosestMeasure = true; // reply will name the nearest size, not the requested one
          // Resolve the closest product's LIVE price + tracked link deterministically
          // so the reply can be BRIEF and still complete. Without this the model only
          // had {label, price} and had to make a tool call for the link — which it
          // skips when told to be concise, producing a vague "si quieres te comparto".
          let cAmount = Number.isFinite(closest.price) && closest.price > 0 ? closest.price : null;
          let cOrig = null, cLink = null;
          try {
            const cDoc = await toolsMod.findProductInFamilies(closest.size || closest.label || "", familyList, closest.dims);
            if (cDoc) {
              const { resolvePrice, trackedLink } = require("./priceResolver");
              const cpi = await resolvePrice(cDoc);
              if (cpi && cpi.amount) {
                cAmount = cpi.amount;
                cOrig = cpi.hasDiscount && Number.isFinite(cpi.originalPrice) && cpi.originalPrice > cpi.amount ? Math.round(cpi.originalPrice) : null;
                cLink = await trackedLink(cpi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: cDoc.name, productId: String(cDoc._id) });
              }
            }
          } catch (err) {
            console.error("⚠️ closest price/link resolve failed:", err.message);
          }
          if (Number.isFinite(cAmount) && cAmount > 0) {
            allowedAmounts.push(cAmount);
            if (cOrig) allowedAmounts.push(cOrig);
            if (primaryQuoteAmount == null) primaryQuoteAmount = cAmount;
          }
          const priceStr = Number.isFinite(cAmount) && cAmount > 0 ? `$${cAmount}${cOrig ? ` (rebajado de $${cOrig})` : ""}` : "";
          turnContextExtra +=
            `\n- MEDIDA NO LISTA EN CATÁLOGO (pero NO la niegues): la más cercana que sí manejamos es "${closest.label}"${priceStr ? ` ${priceStr}` : ""}${cLink ? ` (link: ${cLink})` : ""}. ` +
            `Responde en 1–2 frases, directo: di esa medida más cercana con su precio${cLink ? " y comparte ESE link (no ofrezcas 'compartirlo', dalo ya)" : ""}, y en frase corta que su medida exacta se hace a medida con un asesor. ` +
            `Sin relleno ni repeticiones (NO "sí, sí la manejamos", NO "puedes ver más detalles y comprarla en este enlace"). NO la niegues, NO inventes medida ni precio, NUNCA digas "no manejamos decimales".`;
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
          if (pi && pi.soldOut) {
            // Active but out of stock → acknowledge AND hand off (capture the lead).
            turnHandoffReason = `Producto AGOTADO ${doc.size || doc.name}: ${pi.handoffReason || "sin stock — pasar con un asesor"}`;
            turnHandoffPreface = `Sí manejamos "${doc.name}" (${doc.size || ""}), pero por el momento está agotada.`;
            turnContextExtra =
              `\n- PRODUCTO AGOTADO + HANDOFF: "${doc.name}" (${doc.size || ""}) está AGOTADO; el sistema lo pasará con un asesor para seguimiento. ` +
              `Acláralo con naturalidad; NO compartas link ni lo cotices para comprar; NUNCA digas que no lo vendemos.`;
          } else if (pi && pi.quoteThenHandoff) {
            // Price resolved but NO purchase link → quote it AND hand off to close.
            turnHandoffReason = `Cotización ${doc.size || doc.name}: ${pi.handoffReason || "sin link de compra — concretar con un asesor"}`;
            turnHandoffPreface = `"${doc.name}" (${doc.size || ""}) tiene un precio de $${pi.amount}${pi.plusIva ? " + IVA" : ""}.`;
            turnContextExtra =
              `\n- COTIZA + HANDOFF: "${doc.name}" (${doc.size || ""}) cuesta $${pi.amount}${pi.plusIva ? " + IVA" : ""} pero NO tiene link de compra en línea; ` +
              `el sistema lo pasará con un asesor para concretar. Dile el PRECIO y que un asesor le ayuda a concretar; NO inventes un link.`;
          } else if (pi && pi.handoff) {
            turnHandoffReason = `Cotización ${doc.size || doc.name}: ${pi.handoffReason || "requiere validación de precio con un asesor"}`;
            turnContextExtra =
              `\n- COTIZACIÓN: la medida ${doc.size || doc.name} requiere que un asesor confirme el precio. NO inventes un precio; dile que lo pasas con un asesor.`;
          } else if (pi && pi.amount) {
            askedMeasureResolved = true;
            const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: doc.name, productId: turnActiveProductId });
            const disc =
              pi.hasDiscount && Number.isFinite(pi.originalPrice) && pi.originalPrice > pi.amount
                ? ` CON DESCUENTO (rebajado de $${Math.round(pi.originalPrice)} a $${pi.amount})`
                : "";
            turnContextExtra =
              `\n- PRODUCTO ACTIVO: el cliente sigue tratando "${doc.name}" (${doc.size || ""}). Precio $${pi.amount}${pi.plusIva ? " + IVA" : ""}${disc}${pi.source === "ml" ? " (Mercado Libre)" : " (inventario)"}.` +
              (link ? ` Link: ${link}.` : "") +
              (pi.plusIva ? ` Este precio es MÁS IVA: di SIEMPRE "$${pi.amount} + IVA".` : "") +
              ` SIEMPRE dile el PRECIO CONCRETO ($${pi.amount})${disc ? ` y que está REBAJADO desde $${Math.round(pi.originalPrice)}` : ""} y COMPARTE el link. ` +
              `NUNCA respondas solo "con descuento" sin el precio y el enlace; NUNCA uses el precio de otra medida ni de la promoción.`;
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

  // Effective context: the pinned promo/default lines are tagged with §D§. They
  // VANISH once they've served their purpose — either the client pivoted to a
  // different measure (promoDismissed) OR the bot has ALREADY replied at least once
  // (the promo is presentable on the FIRST contact, but must NOT re-pitch every
  // turn afterward — that spam was hijacking the conversation). A genuine promo ask
  // is still answered by the deterministic promo path (step 1.1) regardless. The
  // tag never reaches the model.
  const promoAlreadyShown = state.promoDismissed || history.some((h) => h.role === "assistant");
  const effectiveContext = promoAlreadyShown
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
    if (turnHandoffPreface) ctx.handoffPreface = turnHandoffPreface;
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
      // If this turn owed the customer a fact (price quote / sold-out note), lead
      // with it so the handoff message both informs AND collects contact.
      const preface = ctx.handoffPreface ? `${ctx.handoffPreface.trim()} ` : "";
      const ask = `${preface}¡Con gusto te paso con un asesor! 🙌 ¿Me compartes tu nombre y un teléfono para que te contacte?`;
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

  // DETERMINISTIC MEASURE CLAMP — like the price clamp, but for the W×L label. When
  // the customer asked for exactly ONE measure and we quoted it (NOT a nearest-
  // substitution, NOT a multi-measure turn), any divergent W×L token in the reply
  // is rewritten to that measure — so a resolved-8x4 quote can't go out saying
  // "7x4" (real client report). URLs are masked inside clampMeasures, so links are
  // never touched. No-op when those conditions don't hold.
  if (text && primaryQuoteAmount != null && !usedClosestMeasure) {
    try {
      const reqMeasures = extractAllMeasures(String(userMessage || ""));
      if (reqMeasures.length === 1) {
        const { clampMeasures } = require("./priceResolver");
        const d = reqMeasures[0];
        const lit = String(userMessage).match(/(\d{1,3}(?:\.\d+)?)\s*[x×]\s*(\d{1,3}(?:\.\d+)?)/);
        const canonical = lit ? `${lit[1]}x${lit[2]}` : `${d[0]}x${d[1]}`;
        const cm = clampMeasures(text, canonical, [d]);
        if (cm.changed) {
          console.warn(`📐 [workflow] measure clamp rewrote a wrong measure → ${canonical} for ${opts.psid || "(no psid)"}`);
          text = cm.text;
        }
      }
    } catch (e) {
      console.error("⚠️ measure clamp failed:", e.message);
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
  // SHADE MISMATCH: the customer named a shade % that this SIZE isn't stocked in,
  // so the resolver fell back to another shade. Surface it so the reply CLARIFIES
  // ("en esa medida no manejamos X%; la tenemos en Y%") instead of silently
  // quoting a different shade.
  let shadeMismatch = null;
  const reqShade = (String(message).match(/(\d{2,3})\s*(?:%|por\s*ciento|porciento)/i) || [])[1] || null;
  if (reqShade) {
    const actualShade = await toolsMod.productShade(doc).catch(() => null);
    if (actualShade && actualShade !== reqShade) {
      const available = await toolsMod.availableShadesForMeasure(familyList, wantDims).catch(() => []);
      shadeMismatch = { requested: reqShade, actual: actualShade, available };
    }
  }
  return { name: doc.name, id: String(doc._id), priceInfo: await resolvePrice(doc), variants, shadeMismatch };
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

// Deploy verification marker — bump on each deploy to confirm the ENGINE code
// actually landed on Railway (the build cache has silently served stale code).
const ENGINE_BUILD = "build-2026-07-06-cutover-D";
module.exports = { runWorkflowTurn, initState, ENGINE_BUILD };
