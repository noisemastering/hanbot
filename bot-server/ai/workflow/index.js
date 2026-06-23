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

  // 1.1 VERBATIM PROMO PITCH (sent ONCE, when the customer asks about the promo).
  // If the active promo has a sales pitch and we haven't sent it, a tiny gpt-4o-mini
  // intent check decides whether THIS message asks for the promo. If so, we send
  // the pitch EXACTLY as written and return — skipping the router, node LLM and
  // verifier entirely (token-cheap). When there's no pitch, this never runs and
  // the LLM handles the promo normally.
  if (userMessage && (state.promoPitch || state.promoQuote) && !state.promoPitchSent) {
    try {
      const { wantsPromo } = require("../utils/promoIntent");
      if (await wantsPromo(String(userMessage))) {
        // Pitch wins if set; otherwise send the deterministic quote (product +
        // promo price + tracked link). Either way the bot answers the promo ask
        // directly — the router never gets a chance to detour to handoff.
        let reply = null;
        let kind = null;
        if (state.promoPitch) {
          reply = String(state.promoPitch);
          kind = "verbatimPitch";
        } else if (state.promoQuote && state.promoQuote.amount) {
          const q = state.promoQuote;
          const label = q.label ? q.label.charAt(0).toUpperCase() + q.label.slice(1) : "El producto en promoción";
          reply =
            `¡Claro! ${label} está en promoción por $${q.amount}.` +
            (q.link ? ` Puedes comprarla aquí: ${q.link}` : "");
          kind = "promoQuote";
        }
        if (reply) {
          history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
          return {
            reply,
            state: { ...state, history, promoPitchSent: true, nodeId: currentNode.id },
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

  const familyList = require("../../models/Workflow").familyListOf(workflow);

  // 1.5 ENGINE-SIDE OUT-OF-FAMILY DETECTION (does not rely on the model calling a
  // tool). If the customer's message points at a product handled by ANOTHER active
  // flow, switch deterministically — product switches need no confirmation.
  if (userMessage && (opts._switchDepth || 0) < 2 && !opts.sandboxNoAutoSwitch) {
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
      const wantDims = (await extractMeasure(String(userMessage))) || dimsOf(String(userMessage));
      const found = await resolveInFamilyMeasure(String(userMessage), familyList, wantDims);
      if (found && found.priceInfo) {
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
          // psid-traceable link so a click here is attributed (commerce-status).
          const { trackedLink } = require("./priceResolver");
          const link = await trackedLink(pi.link, {
            psid: opts.psid || null,
            sandbox: !!opts.sandbox,
            productName: found.name,
            productId: found.id,
          });
          turnContextExtra =
            `\n- COTIZACIÓN SOLICITADA AHORA: el cliente pregunta por "${found.name}". Precio $${pi.amount}${pi.source === "ml" ? " (Mercado Libre)" : " (inventario)"}.` +
            (link ? ` Link: ${link}.` : "") +
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
      } else {
        // The customer named a MEASURE we couldn't resolve in catalog (e.g.
        // 13x3 — out of range). Find the closest available size so the bot
        // offers a REAL size and asks if they still want the exact one —
        // instead of inventing a size or saying "no manejamos decimales".
        const toolsMod = require("./tools");
        if (wantDims) {
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
  const preloaded = (state.preloadedAmounts || []).filter((a) => Number.isFinite(a) && a > 0);
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

  // 2. route
  const decision = await route(workflow, currentNode, history, contextBlock);
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
    contextBlock + turnContextExtra
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
      const facts = `${contextBlock}${turnContextExtra}${toolFacts ? "\n" + toolFacts : ""}`;
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
