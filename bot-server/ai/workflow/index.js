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
// How long a "give me your name + phone" ask stays pending. Past this, a returning
// customer's message is a NEW question, not the contact info we asked for.
const PENDING_HANDOFF_TTL_MS = 12 * 60 * 60 * 1000; // 12h

const { route } = require("./router");
const { executeNode } = require("./nodeExecutor");
const { resolveSetupContext } = require("./setupContext");
// fmtMoney renders every price the bot says (see priceResolver). Imported at
// module scope because the per-gate destructures of priceResolver vary — some
// pull { resolvePrice, trackedLink }, others only { trackedLink } — so a
// formatter every gate needs must not depend on which form a gate happened to
// use. Two gates referenced it without it being in scope and threw
// "fmtMoney is not defined" into a try/catch, which degraded the reply into a
// denial instead of a quote. priceResolver's dependency tree never reaches this
// file, so this cannot cycle.
const { fmtMoney, colorChoiceForProduct, colorChoiceText } = require("./priceResolver");

// Alternate-marketplace routing option for a resolvePrice call. Returns { altPos }
// when this product is one the campaign routed to a non-default POS, else {} (the
// normal ML/default path). Used to keep IN-FLOW quotes consistent with the preload.
function altOpt(state, doc) {
  const ids = state && state.altProductIds;
  if (state && state.altPos && doc && doc._id && Array.isArray(ids) && ids.map(String).includes(String(doc._id))) {
    return { altPos: state.altPos };
  }
  return {};
}

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
// WHERE WE ARE / WHERE WE SHIP, in one place. §1.0865 owns the turn when that is all
// the customer asked, but a batched message ("Solo ocupo uno!! Dónde están ubicados?")
// is answered by an earlier gate, which used to swallow the location question whole
// (reported: a customer asked twice and got a purchase link and a CP ask instead).
// Any gate that owns such a turn appends this block to its own reply.
function asksLocationOrShipping(text) {
  const s = String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return (
    /\b(donde (estan|se (ubican|encuentran))|ubicaci|ubicados?|direccion|domicilio|sucursal|tienda fisica|planta|en que (estado|ciudad)|de donde son|maps|mapa|como llego)\b/.test(s) ||
    /\b(hacen? env[ií]?o?s?|envian|mandan|llega(n)? a|cobertura|a toda la republica|a todo el pais|donde lo (hacen llegar|entregan))\b/.test(s)
  );
}
async function locationBlock() {
  try {
    const { getBusinessInfo } = require("../../businessInfoManager");
    const biz = await getBusinessInfo().catch(() => null);
    if (!biz || (!biz.fullAddress && !biz.googleMapsUrl)) return null;
    const parts = [];
    parts.push(`Estamos en ${biz.city || "Querétaro"}${biz.state && biz.state !== biz.city ? `, ${biz.state}` : ""} y hacemos envíos a toda la República. 📦`);
    if (biz.fullAddress) parts.push(`📍 ${biz.fullAddress}`);
    if (biz.googleMapsUrl) parts.push(`🌐 ${biz.googleMapsUrl}`);
    // MOVE NOTICE — temporary and self-retiring. These are the last days at the
    // current site; from Nov 1 customers find Hanlob at the Colón plant. Shown only
    // while CompanyInfo still holds the OLD address (C.P. 76137) AND we are before
    // Nov 1, so it disappears on its own when the address is updated and in any case
    // after the move — no second deploy, and it can never contradict the address
    // printed above it.
    const MOVE_CUTOFF = Date.parse("2026-11-01T06:00:00Z"); // Nov 1, 00:00 CST
    if (Date.now() < MOVE_CUTOFF && String(biz.zipCode || "").trim() === "76137") {
      parts.push("Estos son nuestros últimos días en esta ubicación: a partir del 1ero de noviembre nos podrás encontrar en nuestra planta en Colón. 🚚");
    }
    return parts;
  } catch {
    return null;
  }
}

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
// ─────────────────────────────────────────────────────────────────────────────
// COLD-START PRICE ANCHORS. An organic "¿cuál es el precio?" names no product and
// no measure, and the Coldstart flow's own prompt says "tu trabajo no es dar
// precios", so the answer was "dime el ancho y el largo" — a price question
// answered with no number at all. Reported twice on 2026-10-23/26 (psids
// 28529106973427095, 29319361417751588), and in both the asesor then answered by
// hand with the ground cover roll prices. The client's call: answer with REAL
// "desde" anchors and then ask the measure.
//
// One anchor per price SCALE a bare "malla" could mean — a confeccionada piece, a
// borde roll, an antimaleza roll — never a catalogue dump. Every number comes from
// resolvePrice (live ML, or the sheet where the rule says so, IVA handled by
// fmtMoney); a leaf that can't be quoted is SKIPPED rather than guessed at, and
// with fewer than two anchors the gate doesn't claim the turn at all.
let _csAnchorCache = { at: 0, anchors: null };
const CS_ANCHOR_TTL_MS = 30 * 60 * 1000;

async function coldStartPriceAnchors() {
  if (_csAnchorCache.anchors && Date.now() - _csAnchorCache.at < CS_ANCHOR_TTL_MS) {
    return _csAnchorCache.anchors;
  }
  const PF = require("../../models/ProductFamily");
  const { resolvePrice } = require("./priceResolver");
  // A length-only product's `size` is not a measure (the borde's is "13x6m" — 13 CM
  // of height by 6 m of length), so those name themselves. Same rule as the promo label.
  const sizeTextOf = (leaf) => {
    const ed = leaf.enabledDimensions;
    const lengthOnly = Array.isArray(ed) && ed.length > 0 && !ed.includes("width");
    if (lengthOnly) return String(leaf.name || "").trim();
    const d = String(leaf.size || "").trim();
    return d ? d.replace(/m$/i, " m").replace(/x/i, "x") : "";
  };
  const SPECS = [
    // Both confeccionadas (MSR-REF reforzada and MSR-SIN con argollas) count toward
    // the floor — "desde" has to be the real cheapest piece we can sell today, and
    // the two differ by a few pesos at 2x2 m.
    { key: "confeccionada", label: "la malla sombra confeccionada", re: /^MSR-(REF|SIN)-/i, lead: "desde" },
    { key: "borde", label: "el borde separador", re: /^CIN-BOR-/i, lead: "desde" },
    // One fixed leaf, not the cheapest: the 2x100 m roll is the anchor the asesores
    // quote by hand, and the cuts (10/25/50 m) are the exception, not the entry point.
    { key: "groundcover", label: "el rollo de antimaleza (ground cover)", code: "GC-ROL-NEG-02X100", lead: "en", sizeFirst: true },
  ];
  const anchors = [];
  for (const spec of SPECS) {
    try {
      const q = { sellable: true, active: { $ne: false }, price: { $gt: 0 } };
      if (spec.code) q.productCode = spec.code;
      else q.productCode = { $regex: spec.re };
      const cands = await PF.find(q)
        .select("name size price priceExcludesTax productCode attributes enabledDimensions parentId stock onlineStoreLinks mlPrice")
        .sort({ price: 1 })
        .limit(spec.code ? 1 : 6)
        .lean();
      for (const leaf of cands) {
        const pi = await resolvePrice(leaf).catch(() => null);
        // A full roll legitimately hands off (an asesor closes it and quotes the
        // freight), so a handoff only disqualifies an anchor when there is no number.
        if (!pi || !pi.amount) continue;
        const sz = sizeTextOf(leaf);
        // "…(ground cover) de 2x100 m en $2111.20 (IVA incluido)" reads; the same
        // clause with the size last gives two parentheticals in a row.
        const text = spec.sizeFirst
          ? `${spec.label}${sz ? ` de ${sz}` : ""} ${spec.lead} ${fmtMoney(pi)}`
          : `${spec.label} ${spec.lead} ${fmtMoney(pi)}${sz ? ` (${sz})` : ""}`;
        anchors.push({ key: spec.key, text });
        break;
      }
    } catch (e) {
      console.error(`⚠️ cold-start anchor "${spec.key}" failed:`, e.message);
    }
  }
  _csAnchorCache = { at: Date.now(), anchors };
  return anchors;
}

async function runWorkflowTurn(workflow, state, userMessage, opts = {}) {
  // 0. Self-correct: a prior turn may have switched the active flow. Always run
  // the flow the STATE points to, regardless of what the caller passed in.
  if (state.workflowId && workflow && String(workflow._id) !== state.workflowId) {
    const active = await loadWorkflowById(state.workflowId);
    if (active) workflow = active;
  }

  const vars = state.vars || {};
  const history = Array.isArray(state.history) ? [...state.history] : [];
  // Facts contributed by the early gates. A gate must NOT end the turn just because
  // it recognised ONE topic — a single message can raise several (a measure AND a
  // payment question), and several messages can deserve one answer. Gates push their
  // fact here and the turn continues, so the model composes ONE reply covering
  // everything. Prices/links are still resolved deterministically elsewhere.
  const earlyFacts = [];

  // The catalog match sorts dimensions ascending so "6x4" and "4x6" resolve to the
  // same leaf. That belongs in MATCHING, not in what we say: a customer who wrote
  // "6x4" was quoted "la de 4x6 m", and "6 piezas de 6x4" became "6 piezas de 4x6".
  // Defined here, at the top of the turn, because gates all the way down render
  // measures back to the customer.
  const rawDimOrder = (txt) => {
    const m = String(txt || "")
      .replace(/(\d)\s*(?:m|mts?|metros?)\b/gi, "$1 ")
      .match(/(\d+(?:[.,]\d+)?)\s*(?:[x×*]|por)\s*(\d+(?:[.,]\d+)?)/i);
    return m ? [m[1], m[2]].map((n) => Number(String(n).replace(",", "."))) : null;
  };
  const dimTxt = (dims, unit = " m") => {
    if (!dims || dims.length !== 2) return null;
    const raw = rawDimOrder(userMessage);
    const key = (p) => [...p].sort((a, b) => a - b).join("|");
    const [a, b] = raw && key(raw) === key(dims) ? raw : dims;
    return `${a}x${b}${unit}`;
  };

  // Resolve the setup CONTEXT once per (flow within a) conversation.
  if (state.contextBlock === undefined) {
    try {
      const Workflow = require("../../models/Workflow");
      const familyList = Workflow.familyListOf(workflow);
      const { contextBlock, product, priceInfo, catalog, preloadedAmounts, promoPitch, promoQuote, altPos, altProductIds } = await resolveSetupContext(
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
      // Alternate-marketplace routing (campaign-scoped) — so in-flow quotes for the
      // routed products price through the same alt POS as the preload.
      state.altPos = altPos || null;
      state.altProductIds = altProductIds || [];
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
  // A pending ask must NOT swallow whatever the customer says next, forever. Two
  // guards (reported 3×: a 4x5 quote, a quality-complaint detail, and a payment
  // question — all answered with "un asesor te contactará" instead):
  //   (a) STALE — the ask is hours/weeks old; the customer came back with a NEW
  //       question, not the phone number we asked for back then.
  //   (b) NOT CONTACT INFO — the message carries no name/phone but clearly IS a
  //       question (a measure, a price/payment/shipping ask, a "?").
  // In either case drop the pending ask and let the turn be answered normally.
  if (userMessage && state.pendingHandoff) {
    try {
      const { extractPhone, extractName, looksLikeBareName } = require("./handoffGate");
      const _m = String(userMessage);
      const askedAt = state.pendingHandoff.askedAt ? new Date(state.pendingHandoff.askedAt).getTime() : null;
      const isStale = askedAt ? Date.now() - askedAt > PENDING_HANDOFF_TTL_MS : false;
      const hasContact = !!(extractPhone(_m) || extractName(_m) || looksLikeBareName(_m));
      const isNewQuestion =
        /\?|\bprecio\b|cu[aá]nto|c[oó]mo\b|pag(?:o|a|ar|ar[ií]a|an)\b|env[ií]o|entrega|medida|garant|instalaci|\d{1,3}\s*[x×]\s*\d{1,3}/i.test(_m);
      if (isStale || (!hasContact && isNewQuestion)) {
        console.log(
          `🧹 [workflow] dropping pending handoff ask (${isStale ? "stale" : "new question, not contact info"}) for ${opts.psid || "(no psid)"}`
        );
        state.pendingHandoff = null;
      }
    } catch (err) {
      console.error("⚠️ pending-handoff guard failed:", err.message);
    }
  }
  // Is this the GROUND COVER campaign? The client wrote that campaign its own opening
  // and wording rules (2026-10-27): it opens with two messages carrying the promo
  // prices, and it never announces the canalización. Every gate that branches on it is
  // marked §N for the rule it implements. The Raschel rollo flow is untouched — its
  // families carry a shade % in their names, ground cover's do not.
  const _gcFlow = (() => {
    try {
      const fams = require("../../models/Workflow").familyListOf(workflow) || [];
      return fams.length > 0 && fams.every((f) => /ground\s*cover|antimaleza/i.test(f.name || ""));
    } catch { return false; }
  })();

  // COLONIA. The asesor quotes the freight from the CP *and* the colonia, and the Ground
  // Cover campaign asks for it by name — but the engine captured only the CP, so a
  // customer who answered "CP 76000, colonia Centro" had half their answer thrown away.
  // It runs HERE, ahead of the pending-handoff resume, because that resume is exactly
  // the turn the colonia arrives on and it returns before the passive capture below.
  // Deliberately NOT part of `gotContact`: a colonia is not a way to reach anyone, so it
  // must never satisfy the contact check or stamp contactDay.
  if (userMessage) {
    const col = String(userMessage).match(
      /\b(?:col(?:onia)?\.?|fracc(?:ionamiento)?\.?|barrio|unidad\s+habitacional)\s+((?!postal\b)[a-z0-9áéíóúñ][a-z0-9áéíóúñ.\s]{2,38})/i
    );
    if (col && !(state.location && state.location.neighborhood)) {
      const v = col[1].trim().replace(/[,;.]+$/, "").replace(/\s+/g, " ");
      if (v) state.location = { ...(state.location || {}), neighborhood: v };
    }
  }

  if (userMessage && state.pendingHandoff) {
    try {
      const { looksLikeBareName, firstGivenName, cleanPersonName } = require("./handoffGate");
      if (!(state.lead && state.lead.name) && looksLikeBareName(String(userMessage))) {
        state.lead = { ...(state.lead || {}), name: String(userMessage).trim() };
      }
      // WHOLESALE: capture HOW MANY items they want (asked on the prior turn) — a small
      // count they typed in reply. \d{1,4} bounded, so it won't grab a 10-digit phone.
      if (state.pendingHandoff.wholesale && !(state.lead && state.lead.wholesaleQty)) {
        const qn = (String(userMessage).match(/\b(\d{1,4})\b/) || [])[1];
        if (qn) state.lead = { ...(state.lead || {}), wholesaleQty: qn };
      }
      // Persist the completed lead (name + phone + zip/city) to the profile.
      if (opts.psid) {
        const nm = cleanPersonName((state.lead && state.lead.name) || "").split(/\s+/).filter(Boolean);
        require("../utils/locationStats").ensureUserProfile(opts.psid, {
          first_name: nm[0] || undefined,
          last_name: nm.length > 1 ? nm.slice(1).join(" ") : undefined,
          phone: (state.lead && state.lead.phone) || undefined,
          zipcode: (state.location && (state.location.zipcode || state.location.zip)) || undefined,
          city: (state.location && state.location.city) || undefined,
        }, "handoff").catch(() => {});
      }
      // A WHOLESALE lead who answers with the ORDER ITSELF ("50 rollos de 18") has
      // earned a reference price for exactly that order: §2.B calls that price the
      // clearest read on how real the prospect is and says explicitly not to drop it
      // just because the ask is mayoreo. The borde gate below quotes it and re-issues
      // this same data request, so yield the turn to it rather than closing the
      // conversation with a bare "¡Gracias!". The quantity is already captured above.
      // A WHOLESALE lead who comes back with a QUANTITY is still negotiating the order,
      // not handing over contact details. Two shapes matter: the full order line
      // ("50 rollos de 18" — §2.B wants its reference price, the clearest read on how
      // real the prospect is) and a DOWNSIZE ("mejor solo uno"), which under §3.2 turns
      // the request back into an individual purchase the bot can close by itself. Both
      // closed the conversation with a bare "¡Gracias!" before. The borde gate below
      // handles them and re-issues this same data request, so yield the turn to it.
      const _wsMsg = String(userMessage);
      const yieldForBordeQty =
        state.pendingHandoff.wholesale &&
        /borde/i.test(workflow.name || "") &&
        (/\b\d{1,3}\s*(?:rollos?|piezas?|pzas?|tramos?|unidades?)?\s*(?:de|del)\s+(?:los?\s+)?(?:6|9|18|54)\b/i.test(_wsMsg) ||
          (!!state.bordeWholesaleLen &&
            !/\d{5}/.test(_wsMsg) &&
            !/\d{10}/.test(_wsMsg.replace(/\D/g, "")) &&
            (/\b\d{1,3}\b/.test(_wsMsg) || /\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i.test(_wsMsg))));
      const baseReason = state.pendingHandoff.reason || "El cliente requiere atención de un asesor";
      const reason = (state.lead && state.lead.wholesaleQty) ? `${baseReason} — interés: ~${state.lead.wholesaleQty} piezas` : baseReason;
      const who = state.lead && state.lead.name ? `, ${firstGivenName(state.lead.name)}` : "";
      // §3: on the Ground Cover campaign the customer hears about their cotización, not
      // about our internal canalización. The escalation itself is unchanged.
      const reply = _gcFlow
        ? `¡Gracias${who}! 🙌 Con esto preparamos tu cotización y te la compartimos en seguida.`
        : `¡Gracias${who}! 🙌 Un asesor te contactará lo antes posible para ayudarte.`;
      if (!yieldForBordeQty) {
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
      }
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
  if (userMessage && !(_gcFlow && !state.gcOpenerSent)) {
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

  // THE CUSTOMER IS DEFERRING, NOT ASKING. "Voy a chequear" / "ya le dije que lo van a
  // checar" / "una vez me den respuesta yo le digo" is a polite pause, and the only
  // right answer is to acknowledge it and get out of the way. Reported 2026-10-27
  // (psid 29251119614512301, "al final contestaba lo mismo"): those three messages got
  // the SAME sentence three times — "¡Gracias! Ya te pasé los precios de los rollos de
  // 6 m, 9 m, 18 m, 54 m. ¿Cuál te sirve y cuántos necesitas?" — because the borde
  // nudge is a catch-all for any turn that carries neither a length nor a count, and a
  // deferral carries neither. Pushing a buying question at someone who just said they
  // need to check with someone else is exactly the "insistir" the client's rules forbid.
  //
  // Deliberately strict: the message must be NOTHING but the deferral (no digits, no
  // measure, short), so "voy a checar, ¿cuánto el de 18?" still gets its answer.
  if (userMessage && !state.pendingHandoff) {
    const _d = String(userMessage).trim();
    const defers =
      _d.length <= 90 &&
      !/\d/.test(_d) &&
      /\b(voy\s+a\s+(chequear|checar|revisar|verlo|verla|pensarlo?|consultarlo?|preguntar)|lo\s+(checo|chequeo|reviso|pienso|consulto|platico|pregunto)|d[eé]jame\s+(pensarlo|checarlo|revisarlo|consultarlo|verlo|preguntar)|lo\s+voy\s+a\s+pensar|ya\s+le\s+dije\s+que\s+lo\s+van\s+a\s+(checar|chequear|revisar|ver)|van\s+a\s+(checarlo|chequearlo|revisarlo|verlo)|una\s+vez\s+me\s+den\s+respuesta|cuando\s+me\s+(digan|confirmen|contesten|respondan)|yo\s+(le|les|te)\s+(aviso|digo|busco|contacto|marco|escribo)|(le|les|te)\s+aviso|lo\s+comento\s+con|lo\s+platico\s+con)\b/i.test(_d);
    if (defers) {
      // Each repeat gets SHORTER, never louder. Someone saying "I'll check" three
      // times is winding the conversation down, and answering with the same warm
      // paragraph every time is its own kind of nagging. The last line is the floor:
      // it is short enough to bear repeating if they keep going.
      const _n = (state.deferCount || 0) + 1;
      state.deferCount = _n;
      state.customerDeferred = true;
      const reply =
        _n === 1
          ? `¡Claro, sin problema! Aquí quedo a la orden — cuando lo revises me dices y seguimos. 😊`
          : _n === 2
          ? `¡Claro! Aquí estamos cuando lo necesites. 😊`
          : `Quedo al pendiente. 🙌`;
      history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
      return {
        reply,
        state: { ...state, history, nodeId: currentNode.id },
        diagnostics: {
          workflow: { id: String(workflow._id), name: workflow.name },
          fromNode: { id: currentNode.id, name: currentNode.name },
          toNode: { id: currentNode.id, name: currentNode.name },
          customerDeferred: true,
        },
      };
    }
  }

  // Passive SAME-DAY contact capture. If the customer VOLUNTEERS their name or a phone
  // this turn, remember it on state.lead so a handoff USES it instead of re-asking
  // (reported: gave "Eduardo Navarro" + phone, bot still asked "¿me compartes tu nombre
  // y un teléfono?"). Stamped with the MX day so a name from a PRIOR-day session is
  // never silently reused.
  const _mxDay = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
  if (userMessage) {
    try {
      const { looksLikeName } = require("../../utils/convoSaleMatcher");
      const raw = String(userMessage);
      state.lead = state.lead || {};
      let gotContact = false;
      const mm = raw.match(/\b(?:me llamo|mi nombre es|a nombre de)\s+([a-záéíóúñ.]+(?:\s+[a-záéíóúñ.]+){0,2})/i)
        || raw.match(/\b([a-záéíóúñ.]+(?:\s+[a-záéíóúñ.]+){1,2})\s+es mi nombre\b/i)
        || raw.match(/^\s*soy\s+([a-záéíóúñ.]+(?:\s+[a-záéíóúñ.]+){0,2})\s*$/i);
      if (mm && looksLikeName(mm[1])) {
        if (!state.lead.name) state.lead.name = mm[1].trim().replace(/\b([a-záéíóúñ])/g, (c) => c.toUpperCase());
        gotContact = true;
      }
      const ph = raw.replace(/[\s\-().]/g, "").match(/\b(\d{10})\b/); // MX mobile = 10 digits (CP/price won't match)
      if (ph) { if (!state.lead.phone) state.lead.phone = ph[1]; gotContact = true; }
      // Top-level day stamp (persists across turns; nested lead fields get rebuilt). It
      // marks the LAST day the customer gave contact, so the handoff only reuses a name
      // that's from TODAY — never a stale prior-day one.
      if (gotContact) state.contactDay = _mxDay();
    } catch { /* capture is best-effort */ }
  }

  // Collect-before-handoff for the DETERMINISTIC early-return paths (steps 1.x)
  // that run BEFORE the post-node handoff gate. Mirrors that gate: if we already
  // have a reachable contact, complete the handoff now; otherwise ask for name +
  // phone — prefaced with any fact we owe the customer (a price quote, a sold-out
  // note) so one message both informs AND collects — and arm pendingHandoff so
  // their reply completes it next turn.
  const beginHandoff = ({ preface, reason, wholesale, complaint } = {}) => {
    const pre = preface ? `${String(preface).trim()} ` : "";
    // Same-day guard: only reuse a name/phone if the customer gave contact TODAY
    // (state.contactDay). No stamp (legacy lead from elsewhere) still counts —
    // backward-compatible.
    const _fresh = !state.contactDay || state.contactDay === _mxDay();
    const haveContact = !!(_fresh && state.lead && (state.lead.phone || state.lead.email || state.lead.name));
    // A WHOLESALE handoff must ALSO capture HOW MANY items they want (for the volume
    // quote) — don't escalate straight through until we have that quantity too.
    const wholesaleNeedsQty = !!wholesale && !(state.lead && state.lead.wholesaleQty);
    if (haveContact && !wholesaleNeedsQty) {
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
      const who = state.lead.name || opts.profileName
        ? `, ${String(state.lead.name || opts.profileName).split(/\s+/)[0]}`
        : "";
      // §3 of the Ground Cover campaign spec: don't announce the canalización or narrate
      // internal process — the conversation is about getting the customer their quote.
      // The handoff itself is unchanged (a full roll is always closed by an asesor, the
      // 2026-10-23 ROLLO COMPLETO rule); only what the customer hears changes, and only
      // on this campaign.
      const reply = _gcFlow
        ? `${pre}¡Gracias${who}! 🙌 Con esto preparamos tu cotización y te la compartimos en seguida.`
        : `${pre}¡Gracias${who}! 🙌 Un asesor te contactará lo antes posible para ayudarte.`;
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
    // Ask for whatever we still need: the wholesale quantity (mayoreo) + name/phone.
    // A phone must be the FULL 10 digits — nudge that in the ask.
    const _lead = state.lead || {};
    const _qtyAsk = wholesaleNeedsQty ? "¿Cuántas piezas te interesan? " : "";
    const _haveZip = !!(state.location && (state.location.zip || state.location.zipcode));
    // The NAME is captured from the platform profile at chat start, never asked —
    // opts.profileName carries it (ai/index.js validates it with looksLikeName).
    // Asking for a name the brief already prints reads as if we hadn't been paying
    // attention; ask only for what's genuinely missing.
    const _knownName = _lead.name || opts.profileName || null;
    // GROUND COVER (§2 + §3): ask ONLY for what is still missing — including the
    // colonia, which the asesor needs for the freight — and frame it as preparing the
    // cotización rather than as handing the customer over.
    // A COMPLAINT IS NOT A QUOTE. Someone who just told us nobody answered them does
    // not want a cotización form; asking for their name, CP and colonia "para incluir
    // el envío" in the same breath is the brush-off all over again. Ask for the one
    // thing we actually need to call them back, and nothing else.
    if (complaint) {
      const askC = _lead.phone ? "" : "¿Me compartes un teléfono a 10 dígitos para que te busque?";
      const replyC = `${pre}${askC}`.trim();
      history.push({ role: "assistant", text: replyC, nodeId: currentNode.id, at: new Date() });
      return {
        reply: replyC,
        state: { ...state, history, nodeId: currentNode.id, pendingHandoff: { reason: reason || null, wholesale: false, attempts: 1, askedAt: new Date() } },
        diagnostics: {
          workflow: { id: String(workflow._id), name: workflow.name },
          fromNode: { id: currentNode.id, name: currentNode.name },
          toNode: { id: currentNode.id, name: currentNode.name },
          handoffPendingContact: true,
          complaint: true,
        },
      };
    }
    if (_gcFlow) {
      const need = [];
      if (!_knownName) need.push("a nombre de quién la preparamos");
      if (!_lead.phone) need.push("un teléfono a 10 dígitos");
      if (!_haveZip) need.push("tu código postal");
      if (!(state.location && state.location.neighborhood)) need.push("tu colonia");
      const list = need.length > 1 ? `${need.slice(0, -1).join(", ")} y ${need[need.length - 1]}` : need[0];
      const askG = need.length ? `¿Me compartes ${list}? Es para incluir el envío.` : "";
      const replyG = `${pre}¡Con gusto te preparamos tu cotización! 😊📋 ${_qtyAsk}${askG}`.trim();
      history.push({ role: "assistant", text: replyG, nodeId: currentNode.id, at: new Date() });
      return {
        reply: replyG,
        state: { ...state, history, nodeId: currentNode.id, pendingHandoff: { reason: reason || null, wholesale: !!wholesale, attempts: 1, askedAt: new Date() } },
        diagnostics: {
          workflow: { id: String(workflow._id), name: workflow.name },
          fromNode: { id: currentNode.id, name: currentNode.name },
          toNode: { id: currentNode.id, name: currentNode.name },
          handoffPendingContact: true,
        },
      };
    }
    const _contactAsk = (!_knownName || !_lead.phone)
      ? `¿Me compartes ${_knownName ? "" : "tu nombre, "}un teléfono a 10 dígitos${_haveZip ? "" : " y tu código postal"} para que te contacte?`
      : _haveZip
      ? ""
      : "¿Me compartes tu código postal para cotizarte el envío?";
    const reply = `${pre}¡Con gusto te paso con un asesor! 🙌 ${_qtyAsk}${_contactAsk}`.trim();
    history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
    return {
      reply,
      state: { ...state, history, nodeId: currentNode.id, pendingHandoff: { reason: reason || null, wholesale: !!wholesale, attempts: 1, askedAt: new Date() } },
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

  // PAYMENT: no gate here on purpose. Detecting "is this a payment question" with a
  // regex kept failing on the next phrasing ("El pago como es!?", "forma de pago"),
  // and each miss let the turn fall through and escalate. The answer now lives in the
  // flow's knowledge, which is injected on EVERY turn, so no detection is needed and
  // no phrasing can be missed.

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

  // 1.066 A BARE PRICE ASK IN COLD START — "¿cuál es el precio?" / "¿cuál es el
  // precio de la malla?" with no product and no measure. See coldStartPriceAnchors
  // above for why this answers with numbers instead of asking for the measure.
  // A SPECIFIC product word (sombra, rollo, antimaleza, borde…) means the flow can
  // route it properly, so the gate only takes the genuinely ambiguous ask; a bare
  // "malla" IS ambiguous — it is as much antimaleza as it is sombra. Fires once per
  // conversation: if they ask again without naming anything, the model takes over
  // rather than repeating the same three lines.
  if (userMessage && workflow.isColdStart && !state.coldStartAnchorsSent) {
    try {
      const msgCs = String(userMessage);
      const { dimsOf, wantsWholesale } = require("./tools");
      const asksPrice = /\b(precio|precios|costo|costos|cotiza\w*|a\s+c[oó]mo)\b/i.test(msgCs) ||
        /\bcu[aá]nto\s+(cuesta|cuestan|sale|salen|vale|valen|es|ser[ií]a)\b/i.test(msgCs);
      const namesProduct =
        /\b(sombra|rollo|rollos|antimaleza|anti\s*maleza|ground\s*cover|groundcover|borde|separador|monofilament\w*|cinta|kit|sujetador\w*|ojill\w*|cord[oó]n|lazo|herraj\w*|argolla\w*|raschel)\b/i.test(msgCs);
      if (asksPrice && !namesProduct && !dimsOf(msgCs) && !wantsWholesale(msgCs) && !state.promoQuoted) {
        const anchors = await coldStartPriceAnchors();
        if (anchors.length >= 2) {
          const parts = anchors.map((a) => a.text);
          const list = parts.length > 1
            ? `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`
            : parts[0];
          const reply = `Depende del producto: ${list}. ¿Cuál te interesa y de qué medida? 😊`;
          history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
          return {
            reply,
            state: { ...state, history, nodeId: currentNode.id, coldStartAnchorsSent: true },
            diagnostics: {
              workflow: { id: String(workflow._id), name: workflow.name },
              fromNode: { id: currentNode.id, name: currentNode.name },
              toNode: { id: currentNode.id, name: currentNode.name },
              coldStartPriceAnchors: anchors.map((a) => a.key),
            },
          };
        }
      }
    } catch (e) {
      console.error("⚠️ cold-start price anchors gate failed:", e.message);
    }
  }

  // 1.065 EXPLICIT WHOLESALE INTENT (any product flow) → asesor handoff for a volume
  // quote, COLLECTING name+phone via beginHandoff. A bare "mayoreo"/"revendedor"/"para
  // un vivero al mayoreo" needs NO quantity — a human hears it and connects them. This
  // used to be reforzada-only, so rollo/borde/GC wholesale asks fell through (reported:
  // a vivero asking "¿a cómo de mayoreo?" got a retail rollo quote instead of a handoff).
  // COLD START COUNTS TOO. This used to be `!workflow.isColdStart`, so an ORGANIC
  // "Información para ser distribuidor" — no ad, so cold-start owns it — never reached
  // the handoff: psid 28769615639359953 got "Te comparto nuestro catálogo 📄" with
  // nothing attached and no escalation, and a human had to come in and paste the
  // wholesale pitch by hand (reported 2026-10-27). The flow's own knowledge already
  // says to escalate a distributor enquiry and ask for name and phone — but that is a
  // PROMPT, so it was advisory. Which product they want is beside the point here: a
  // distributor lead is a person's job whatever the product, which is exactly why this
  // gate needs no product context and is safe on cold start.
  if (userMessage) {
    try {
      const { wantsWholesale } = require("./tools");
      if (wantsWholesale(String(userMessage))) {
        return beginHandoff({
          preface: `¡Claro que manejamos mayoreo por volumen!`,
          reason: `Mayoreo (solicitud explícita de mayoreo)`,
          wholesale: true,
        });
      }
    } catch (e) { /* fall through to normal handling */ }
  }

  // 1.07–1.08 ROLLO-FLOW DETERMINISTIC HANDLING. The rollo flow has fixed shades
  // (35/50/70/80/90), discrete widths and lengths, so its quoting is enforced in
  // code rather than left to the model:
  //   (a) UNAVAILABLE SHADE — a % we don't carry → specialist handoff.
  //   (b) AREA CONFIRM — a non-standard W×L (e.g. 5x20) → confirm the m² it covers.
  //   (c) RECOMMEND — on confirm, propose the nearest-area real roll + price/link.
  //   (d) QUANTITY GATE — 2+ rolls = mayoreo → specialist handoff.
  //   (e) DECLINE — customer rejects the recommendation → specialist handoff.
  // Set when THIS turn's measure cannot be a roll in this flow (see (c) below). The
  // cross-flow measure router is normally skipped inside a roll flow, and this is the
  // one case where it must still run: the roll flow has just established it cannot
  // serve the measure at all.
  let rollFlowRejectedMeasure = false;
  if (userMessage) {
    try {
      const Wf = require("../../models/Workflow");
      const rolloFams = Wf.familyListOf(workflow) || [];
      const isRollFlow = rolloFams.length > 0 && rolloFams.every((f) => /\brollo\b|ground\s*cover|antimaleza/i.test(f.name || ""));
      if (isRollFlow) {
        const { dimsOf, findProductInFamilies, nearestRollByArea, parseRollQuantity } = require("./tools");
        const { resolvePrice, trackedLink, fmtMoney } = require("./priceResolver");
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
        let dims = dimsOf(msg) || (extractAllMeasures(msg)[0] || null) || rememberedDims;

        // Every sellable ground cover leaf, walked at most once per turn.
        let _gcLeaves;
        const gcLeaves = async () => {
          if (_gcLeaves) return _gcLeaves;
          _gcLeaves = [];
          try {
            let frontier = rolloFams.map((f) => String(f.id)).filter(Boolean);
            for (let d = 0; d < 5 && frontier.length; d++) {
              const kids = await PF.find({ parentId: { $in: frontier } }).lean().catch(() => []);
              if (!kids.length) break;
              _gcLeaves.push(...kids.filter((k) => k.sellable === true));
              frontier = kids.map((k) => String(k._id));
            }
          } catch (e) {
            console.error("⚠️ ground cover leaf walk failed:", e.message);
          }
          return _gcLeaves;
        };
        const gcDim = async (key) =>
          [...new Set((await gcLeaves()).map((k) => Number(k.attributes?.[key])).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);

        // §4 — A BARE LENGTH IS A ROLL LENGTH. The client's own example, verbatim:
        // "Gracias, quiero cotizar 10 metros". It used to reach the bare-price gate
        // (a0-bis) — the word "cotizar" matches it and there is no 2-D measure to stop
        // it — and came back with the two FULL rolls, so a customer who asked for 10 m
        // never saw the 10 m price, which exists and has a buy link. A length alone
        // still cannot be quoted: the WIDTH is what moves the number (2 m or 4 m), so
        // remember it across turns and only then synthesize the measure, which hands the
        // turn to the deterministic quote path at (c) — the same path that owns the
        // colour choice and the link.
        let gcAskWidth = null;
        let gcNearestLen = null;
        if (_gcFlow && !dims) {
          const wM = msg.match(/\b(\d{1,2}(?:[.,]\d+)?)\s*(?:m|mts?|metros?)?\s+de\s+anch/i)
            || msg.match(/\banch[oa]s?\s*(?:de\s*)?(\d{1,2}(?:[.,]\d+)?)\s*(?:m|mts?|metros?)?\b/i);
          const w = wM ? Number(String(wM[1]).replace(",", ".")) : null;
          if (w) state.gcWidth = w;
          // Strip the width phrase so "2 m de ancho por 50" can't read the 2 as the
          // length, and strip m² — an AREA belongs to (a1), which recommends a roll.
          const rest = (wM ? msg.replace(wM[0], " ") : msg)
            .replace(/\b\d+(?:[.,]\d+)?\s*(?:m2|m²|metros?\s+cuadrados?|mts?\s+cuadrados?)\b/gi, " ");
          const lM = rest.match(/\b(\d{1,3}(?:[.,]\d+)?)\s*(?:m|mts?|metros?|ml)\b/i);
          const len = lM ? Number(String(lM[1]).replace(",", ".")) : null;
          if (len) {
            const lens = await gcDim("length");
            const width = state.gcWidth || null;
            if (lens.length && !lens.includes(len)) {
              // Nearest by absolute difference; on a tie prefer the one that COVERS it.
              gcNearestLen = lens.reduce((best, n) => {
                const d1 = Math.abs(n - len), d0 = Math.abs(best - len);
                return d1 < d0 || (d1 === d0 && n > best) ? n : best;
              }, lens[0]);
            } else if (!width) {
              gcAskWidth = len;
            } else {
              dims = [width, len];
            }
          } else if (w && state.gcPendingLen) {
            // They answered the width we asked for ("2 m de ancho") and the LENGTH came
            // a turn earlier. Without remembering it the turn had no measure, fell to
            // the model, and it quoted "$406.80 en negro, con descuento de $407" — a
            // discount equal to the price. The pair is complete now, so build it.
            dims = [w, Number(state.gcPendingLen)];
            state.gcPendingLen = null;
          }
        }
        // Remember the WIDTH off any ground cover measure, however it arrived, so a
        // later bare length ("y de 50 m?") resolves without asking it again.
        if (_gcFlow && dims) {
          const ws = await gcDim("width");
          const w = dims.find((n) => ws.includes(Number(n)));
          if (w) state.gcWidth = Number(w);
        }
        // One-shot "awaiting quantity" flag: set when WE ask "¿cuántos?", so a
        // number reply ("3", "necesito 3", "tres") is read as the quantity next
        // turn. Consumed each turn; re-armed only when we ask again.
        const awaitingQty = !!state.awaitingRollQty;
        state.awaitingRollQty = false;
        let qty = parseRollQuantity(msg); // explicit "N rollos/piezas" — works anytime
        // Same rule as the borde reader: a number carrying cm/mm is a size, not a count
        // ("10 cm de ancho" → 10 rollos). One definition, in tools.js.
        if (qty == null && awaitingQty && !dims && !askedShade && !require("./tools").hasUnitBoundNumber(msg)) {
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
          if (!rec) return beginHandoff({ preface: `Para cubrir ${area} m² lo mejor es una cotización personalizada.`, reason: `Sin rollo para ${area} m²` });
          const sh = await shadeText(rec.leaf);
          const pi = await resolvePrice(rec.leaf, altOpt(state, rec.leaf));
          state.pendingAreaConfirm = null;
          if (pi && pi.amount) {
            const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: rec.leaf.name, productId: String(rec.leaf._id) });
            state.activeProductId = String(rec.leaf._id);
            state.rollRecommendation = { id: String(rec.leaf._id), dims: rec.dims, area };
            const shadePart = sh ? `al ${sh}% ` : "";
            // A recommendation can land on a ROLLO COMPLETO (200 m² → 2x100 m), and
            // then the full-roll rule applies here too: our price with IVA in, no
            // link, asesor closes it. Without this the gate quoted the gross amount
            // as if it were a self-serve price and asked "¿te convence?" with no way
            // to buy and nobody told.
            if (pi.fullRoll) {
              return beginHandoff({
                preface: `Para cubrir ${area} m² te recomiendo un rollo ${shadePart}de ${rec.dims[0]} x ${rec.dims[1]} m, en ${fmtMoney(pi)}. El rollo completo lo cotiza un asesor junto con el envío.`,
                reason: pi.handoffReason || `Rollo completo ${rec.dims[0]}x${rec.dims[1]} recomendado para ${area} m² — cerrar con un asesor`,
              });
            }
            const reply = `Perfecto. Para eso te puedo recomendar un rollo ${shadePart}de ${rec.dims[0]} x ${rec.dims[1]} m, con un precio de ${fmtMoney(pi)}.` + (link ? ` Te dejo el link: ${link}.` : "") + ` Dime si esta opción te convence. 😊`;
            return ret(reply, { rollAreaRecommended: `${rec.dims[0]}x${rec.dims[1]}` });
          }
          state.rollRecommendation = null;
          return beginHandoff({ preface: `Para cubrir ${area} m² te recomiendo un rollo de ${rec.dims[0]} x ${rec.dims[1]} m.`, reason: `Rollo recomendado ${rec.dims[0]}x${rec.dims[1]} sin precio en línea` });
        };

        // The shortest roll length this flow actually stocks. Used to tell a roll
        // request apart from a confeccionada PANEL that happens to carry two numbers.
        // Memoized: the walk is the same one (a0)/(a0-bis) do, and a turn may need it
        // after those have already run.
        let _minRollLen;
        const shortestRollLength = async () => {
          if (_minRollLen !== undefined) return _minRollLen;
          _minRollLen = null;
          try {
            let frontier = rolloFams.map((f) => String(f.id)).filter(Boolean);
            const lens = [];
            for (let d = 0; d < 5 && frontier.length; d++) {
              const kids = await PF.find({ parentId: { $in: frontier } }).lean().catch(() => []);
              if (!kids.length) break;
              for (const k of kids) {
                const l = Number(k.attributes?.length);
                if (k.sellable === true && Number.isFinite(l) && l > 0) lens.push(l);
              }
              frontier = kids.map((k) => String(k._id));
            }
            if (lens.length) _minRollLen = Math.min(...lens);
          } catch (e) {
            console.error("⚠️ shortest roll length failed:", e.message);
          }
          return _minRollLen;
        };

        // Two bubbles in one turn. The Messenger webhook already sends reply.followUp
        // as a second message; the WhatsApp processor had to learn it (dual-channel).
        const retTwo = (reply, followUp, extra) => {
          const r = ret(reply, extra);
          history.push({ role: "assistant", text: followUp, nodeId: currentNode.id, at: new Date() });
          return { ...r, followUp };
        };
        // The full rolls with their prices — Mensaje 1's body. Every number comes from
        // resolvePrice, so the ROLLO COMPLETO rule applies (our price with IVA folded
        // in, no ML link, an asesor closes it and quotes the freight). NOTE: the ad copy
        // writes these as "$1,820 + IVA"; we show the IVA-included total, which is the
        // same money and the 2026-10-23 rule.
        const gcFullRollRows = async () => {
          const byW = new Map();
          for (const k of await gcLeaves()) {
            if (Number(k.attributes?.length) !== 100) continue;
            const w = String(k.attributes?.width || "");
            if (!w || byW.has(w)) continue;
            byW.set(w, k);
          }
          const rows = [];
          for (const w of [...byW.keys()].sort((a, b) => Number(a) - Number(b))) {
            const pi = await resolvePrice(byW.get(w), altOpt(state, byW.get(w))).catch(() => null);
            if (!pi || pi.amount == null) continue;
            rows.push(`• ${w} × 100 m: ${fmtMoney(pi)}`);
          }
          return rows;
        };
        // Mensaje 2 — the invitation to quote. §2: ask only what we don't already have.
        // The NAME is captured from the platform profile at chat start and is never
        // asked (opts.profileName), so that line appears only when we genuinely lack it.
        const gcQuoteInvite = () => {
          const lines = [];
          if (!((state.lead && state.lead.name) || opts.profileName)) lines.push(`👤 ¿A nombre de quién la preparamos?`);
          if (!(state.location && (state.location.zip || state.location.zipcode))) lines.push(`📍 Código postal`);
          if (!(state.location && state.location.neighborhood)) lines.push(`🏘️ Colonia`);
          lines.push(`📦 ¿Qué medida de rollo necesitas y cuántas piezas?`);
          return `¡Con gusto te ayudamos con tu cotización! 😊📋\nPara prepararla e incluir el envío, ¿nos compartes?\n${lines.join("\n")}`;
        };

        // (a0-envio) WHAT THE SHIPPING ACTUALLY COSTS ON A ROLL FLOW. Reported
        // 2026-10-27 (wa:5217227079986): "¿Cuál es el costo de envío?" was answered
        // "El envío ya va incluido en el precio, no se cobra aparte", and two minutes
        // later the SAME conversation quoted his 2 x 100 m roll with "el rollo completo
        // lo cotiza un asesor junto con el envío". The bot contradicted itself about
        // money inside two turns, which is exactly the kind of thing a customer
        // remembers. Root cause: "El costo del envío ya viene incluido en el precio" is
        // a knowledge entry in ALL EIGHT workflows, and it is only true of what is
        // bought on Mercado Libre — a FULL ROLL carries no ML link by the ROLLO COMPLETO
        // rule (2026-10-23) and moves as freight an asesor prices by destination.
        // Same family as the borde's §3.5 mayoreo-shipping gate: a promise of free
        // shipping on an order that doesn't ship that way.
        const asksShipping =
          /\b(env[ií]os?|flete|paqueter[ií]a|transporte|mensajer[ií]a)\b/i.test(msg) &&
          /\b(cu[aá]nto|costo|cuesta|precio|cobran|sale|vale|gratis|incluid[oa]s?|incluye|aparte|extra|manejan|tienen?|hacen|es\s+el)\b/i.test(msg);
        // "¿Cuánto TARDA el envío?" is a different question from "¿cuánto CUESTA?", and
        // this gate was answering both with the cost (found 2026-10-28 while testing
        // the payment gate below). The delivery TIME has the same two cases as
        // everything else here: the cuts ship through Mercado Libre, the full roll
        // moves as freight we schedule by destination — so "llega en 2 días hábiles" (the
        // knowledge entry's number) is not true of the roll either.
        const asksShippingTime =
          /\b(tarda\w*|demora\w*|llega\w*|tiempo\s+de\s+(entrega|env[ií]o)|cu[aá]ndo\s+(me\s+)?(llega|lo\s+env|la\s+env))\b/i.test(msg) ||
          /\bcu[aá]nt[oa]s?\s+d[ií]as\b/i.test(msg);
        if (asksShippingTime && _gcFlow && /\b(env[ií]os?|entrega|pedido|compra|llega|tarda)\b/i.test(msg)) {
          const lensT = await gcDim("length");
          const cutsT = lensT.filter((l) => l !== 100);
          const rollFirstT = (dims && dims.some((d) => Number(d) === 100)) || /\b100\b/.test(msg) || !!state.gcOpenerSent;
          const rollLineT = `El rollo completo de 100 m va por flete y te confirmamos el tiempo junto con el costo del envío.`;
          const cutLineT = cutsT.length
            ? `Los cortes de ${cutsT.join(", ")} m, que se compran en línea, normalmente llegan en 2 días hábiles (puede variar).`
            : "";
          const partsT = rollFirstT ? [rollLineT, cutLineT] : [cutLineT, rollLineT];
          return ret(`${partsT.filter(Boolean).join(" ")} ¿Qué medida necesitas? 😊`, {
            gcDeliveryTimeAnswered: rollFirstT ? "rollo" : "corte",
          });
        }
        if (asksShipping && _gcFlow) {
          const lensE = await gcDim("length");
          const cutsE = lensE.filter((l) => l !== 100);
          const haveZipE = !!(state.location && (state.location.zip || state.location.zipcode));
          // Both halves, every time — the answer cannot be wrong that way. The half
          // that applies to what they're looking at goes first.
          const rollFirst = (dims && dims.some((d) => Number(d) === 100)) || /\b100\b/.test(msg);
          const rollLine = `El rollo completo de 100 m se envía por flete y se cotiza aparte según tu destino: te damos el costo exacto${haveZipE ? "" : " con tu código postal"}.`;
          const cutLine = cutsE.length
            ? `En los cortes que se compran en línea (${cutsE.join(", ")} m) el envío ya va incluido en el precio.`
            : "";
          const parts = rollFirst ? [rollLine, cutLine] : [cutLine, rollLine];
          // We are explicitly asking for the CP, so arm the capture: the PROMPTED path
          // in captureZipReply (ai/index.js) is the lenient one, while an UNPROMPTED
          // reply only counts when it is a bare number that exists in the ZipCode table
          // — "es el 50000" would be dropped and we'd ask the same thing twice.
          if (!haveZipE) state.zipAsked = true;
          return ret(
            `${parts.filter(Boolean).join(" ")} ${haveZipE ? "¿Qué medida necesitas y te la cotizo? 😊" : "¿Me compartes tu código postal y la medida que necesitas? 📍"}`,
            { gcShippingAnswered: rollFirst ? "rollo" : "corte" }
          );
        }

        // (a0-pago) HOW A FULL ROLL IS ACTUALLY PAID. Twin of (a0-envio) above, found
        // the day after it (2026-10-28, from the sandbox): the turn quoted ONLY the two
        // 100 m rolls and the next answer was "la compra se realiza por Mercado Libre…
        // el pago es al momento de ordenar en línea" — for the one product that carries
        // NO ML link (ROLLO COMPLETO, 2026-10-23) and is closed by an asesor. The
        // knowledge entry "Pago / cómo se compra" says Mercado Libre unconditionally in
        // all EIGHT flows, and it orders the model to answer it "SIEMPRE, sin importar
        // cómo lo pregunten" — so it fires hardest right after a full-roll quote. The
        // entry is corrected in the four flows that sell a full roll; this gate is what
        // puts it beyond the model's discretion on the campaign, same as the shipping
        // one: BOTH cases, every time, the applicable half first, so an answer built
        // from two true halves cannot be wrong.
        // The roll half's facts are the client's (2026-10-28): transferencia, or card
        // and cash at the store, and a shipped order is paid UP FRONT — never contra
        // entrega. Nothing here invents a payment method we don't offer.
        const asksPayment =
          /\b(pago|pagar|pagos|forma\s+de\s+pago|m[eé]todos?\s+de\s+pago|transferencia|dep[oó]sito|tarjeta|efectivo|contra\s+entrega|contraentrega|msi|meses\s+sin\s+intereses|factura\w*)\b/i.test(msg) ||
          /\bc[oó]mo\s+(se\s+)?(compr|pag|adquier|realiz)\w*/i.test(msg) ||
          /\bd[oó]nde\s+(se\s+)?(compr|pag)\w*/i.test(msg);
        if (asksPayment && _gcFlow) {
          const lensP = await gcDim("length");
          const cutsP = lensP.filter((l) => l !== 100);
          // Which half they're standing in: a 100 m measure this turn, or a full roll
          // already quoted in this conversation (the opener quotes both of them, so
          // "¿cómo se compra?" right after it is about the roll).
          const rollFirstP =
            (dims && dims.some((d) => Number(d) === 100)) || /\b100\b/.test(msg) ||
            !!state.gcOpenerSent || !!(state.priceInfo && state.priceInfo.fullRoll);
          const rollLineP =
            `El rollo completo de 100 m no se vende por Mercado Libre: la compra se cierra directo con nosotros ` +
            `y se paga por transferencia, o con tarjeta o efectivo si pasas a la tienda; si te lo enviamos, el pago es por adelantado.`;
          const cutLineP = cutsP.length
            ? `Los cortes de ${cutsP.join(", ")} m se compran en línea por Mercado Libre con compra protegida, y ahí mismo pagas al ordenar.`
            : "";
          const partsP = rollFirstP ? [rollLineP, cutLineP] : [cutLineP, rollLineP];
          // "¿Es contra entrega?" is a yes/no question and deserves the word "no" in
          // front of the explanation — leaving it implied ("pagas al ordenar") makes
          // the customer ask again.
          const codP = /\bcontra\s*entrega\b|\bcontraentrega\b/i.test(msg)
            ? "No manejamos pago contra entrega. "
            : "";
          return ret(`${codP}${partsP.filter(Boolean).join(" ")} ¿Qué medida necesitas? 😊`, {
            gcPaymentAnswered: rollFirstP ? "rollo" : "corte",
          });
        }

        // (a0-quejas) §5C of the follow-up spec — the customer says the PRICE, the
        // MEASURE, the INFORMATION or the ATTENTION did not meet expectations. The
        // client's rule: acknowledge it, resolve it ONLY with authorized information,
        // otherwise hand it to a human. We have an authorized answer for a price
        // complaint — the smaller presentations really are cheaper per piece — and we
        // have none at all for "nobody answered me" or "you never told me the price",
        // so those go to a person, with the complaint itself as the handoff reason.
        // Scoped to ground cover and placed before BOTH the opener and the length
        // gates: a complaint is never a measure, and a complaint on the very first turn
        // ("nunca me dijeron el precio") is still a complaint — the opener used to claim
        // it and answer with the price list, which is the brush-off the customer was
        // already complaining about.
        if (_gcFlow) {
          const qAten = /\b(nadie\s+me\s+(contest|respond|atend)\w*|mal[a]?\s+(atenci[oó]n|servicio)|p[eé]sim[oa]\s+(atenci[oó]n|servicio|servicio)|no\s+me\s+(contestaron|respondieron|atendieron|resolvieron)|me\s+dejaron\s+(esperando|colgad[oa]|en\s+visto)|sigo\s+esperando\s+(respuesta|que\s+me)|muy\s+mala\s+atenci[oó]n)\b/i.test(msg);
          const qInfo = /\b(no\s+me\s+(dieron|dijeron|mandaron|pasaron)\s+(el\s+precio|la\s+informaci[oó]n|los\s+precios|nada)|informaci[oó]n\s+(incompleta|confusa|equivocada|err[oó]nea)|nunca\s+me\s+(dijeron|mandaron|contestaron|pasaron)|no\s+entend[ií]\s+nada|no\s+me\s+quedó?\s+claro\s+nada)\b/i.test(msg);
          const qPrecio = /\b(muy\s+car[oa]s?|est[aá]n?\s+car[oa]s?|car[ií]simo|se\s+me\s+hace\s+car[oa]|no\s+me\s+alcanza|fuera\s+de\s+mi\s+presupuesto|est[aá]\s+fuera\s+de\s+presupuesto|m[aá]s\s+barat[oa]\s+en\s+otr\w+)\b/i.test(msg);
          if (qAten || qInfo) {
            return beginHandoff({
              preface: `Lamento que haya quedado así, y gracias por decírmelo. 🙏 Déjame ponerte con alguien que lo revise contigo a detalle.`,
              reason: `Inconformidad del cliente (${qAten ? "atención" : "información"}) en campaña Ground Cover — requiere solución personalizada`,
              complaint: true,
            });
          }
          if (qPrecio) {
            // The authorized answer, ONCE: the smaller cuts cost less per piece. If we
            // have already shown them and the price is still the objection, there is
            // nothing more we are allowed to offer — that is a person's call, not ours
            // (we never invent a discount).
            if (state.gcPriceObjection) {
              return beginHandoff({
                preface: `Entiendo, y gracias por tu franqueza. 🙏 Déjame ponerte con un compañero para ver qué se puede hacer con el precio.`,
                reason: `Inconformidad de PRECIO en campaña Ground Cover tras ofrecer las presentaciones más chicas — revisar con el cliente`,
                complaint: true,
              });
            }
            const lensQ = await gcDim("length");
            const cutsQ = lensQ.filter((l) => l !== 100);
            if (cutsQ.length) {
              const wsQ = await gcDim("width");
              state.gcPriceObjection = true;
              return ret(
                `Te entiendo. 🙏 El rollo completo de 100 m es el que sale más alto; si no necesitas tanto, lo cortamos en ${cutsQ.join(", ")} m y la pieza te cuesta mucho menos. ¿Cuántos metros necesitas y de qué ancho, ${wsQ.length ? wsQ.map((w) => `${w} m`).join(" o ") : "2 m o 4 m"}? Te paso el precio exacto. 😊`,
                { gcPriceObjection: cutsQ.length }
              );
            }
          }
        }

        // (a0-opener) §1 — THE CAMPAIGN'S TWO OPENING MESSAGES. Mensaje 1 presents the
        // product with its promo prices; Mensaje 2 invites the quote and asks for the
        // data to prepare it. Before this, the first turn of a Ground Cover ad was
        // answered "¡Hola! …¿En qué te puedo ayudar?" — no product, no prices, no
        // invitation, the opposite of what the ad promises. They go out as SEPARATE
        // bubbles, which is the whole point of splitting them: short and interactive.
        // It fires only when the opening message carries nothing else to answer — a
        // first message that asks something specific is answered, not talked over.
        if (_gcFlow && !state.gcOpenerSent && !history.some((h) => h.role === "assistant")) {
          const t = String(userMessage || "").trim();
          const isOpener =
            t.length <= 70 && !dims && !gcAskWidth && !gcNearestLen && qty == null &&
            // No digits at all: any number is a measure, an area ("3 hectáreas") or a
            // quantity, and the opener must never talk over one.
            !/\d/.test(t) &&
            /\b(hola|buen[oa]s?|qu[eé]\s+tal|info|informaci[oó]n|precio|precios|costo|costos|cotiza\w*|me\s+interesa|interesad[oa]|disponible|quiero|busco|necesito)\b/i.test(t) &&
            // A question about the MEDIDAS is not the opener's to answer — the size
            // list below owns it, and answering only the price half would drop the
            // other ("Que medidas tiene y precio?" is one question, not two turns).
            !/\b(medidas?|tama[nñ]os?|presentaci[oó]n(es)?|dimensiones?|anchos?|largos?|hect[aá]reas?)\b/i.test(t) &&
            !/\b(env[ií]o|entrega|pago|pagar|factur|garant|instalaci|ubicaci|direcci|d[oó]nde|color|negro|blanco|mayoreo|distribuidor)\b/i.test(t);
          if (isOpener) {
            const rows = await gcFullRollRows();
            if (rows.length) {
              state.gcOpenerSent = true;
              // Mensaje 2 IS the collect-before-handoff ask, so arm the pending handoff:
              // the quoted rolls are full rolls, which an asesor always closes and
              // quotes the freight for (ROLLO COMPLETO, 2026-10-23), and §2 wants the
              // alert raised with whatever data we have. If the customer replies with a
              // measure or another question instead of their data, the guard above drops
              // the pending ask and the turn is served normally.
              state.pendingHandoff = {
                reason: `Campaña Ground Cover: cotizados los ${rows.length} rollos completos en el mensaje de apertura; el asesor cierra la venta y cotiza el envío`,
                wholesale: false,
                attempts: 1,
                askedAt: new Date(),
              };
              return retTwo(
                `¡Precios de promoción! 🌱\n` +
                  `Malla antimaleza (Ground Cover), disponible en negro y blanco al mismo precio:\n` +
                  `${rows.join("\n")}\n` +
                  `Ideal para controlar el crecimiento de maleza en cultivos y jardines, favoreciendo el aprovechamiento del agua y los nutrientes.`,
                gcQuoteInvite(),
                { gcOpener: rows.length }
              );
            }
          }
        }
        // §4 continued — the two cases a bare length cannot resolve on its own.
        if (gcNearestLen) {
          const ws = await gcDim("width");
          const wTxt = ws.length ? ws.map((w) => `${w} m`).join(" y ") : "2 m y 4 m";
          state.gcWidth = null; // their stated width, if any, was for a length we don't cut
          return ret(
            `Ese largo exacto no lo cortamos. El más cercano es el rollo de ${gcNearestLen} m, en ${wTxt} de ancho y en negro o blanco. ¿Qué ancho necesitas y te paso el precio? 😊`,
            { gcNearestLength: gcNearestLen }
          );
        }
        if (gcAskWidth) {
          const ws = await gcDim("width");
          const wTxt = ws.length ? ws.map((w) => `${w} m`).join(" o ") : "2 m o 4 m";
          state.gcPendingLen = gcAskWidth; // their width reply next turn completes the measure
          return ret(
            `¡Claro, ${gcAskWidth} m! ¿De qué ancho lo necesitas, ${wTxt}? Es lo que cambia el precio. 😊`,
            { gcAskWidth }
          );
        }

        // (a0-ter) A COLOUR GROUND COVER DOESN'T HAVE. "¿la tienen en beige?" was
        // answered "solo negro y blanco… dime el largo o el área que quieres cubrir",
        // which is a dead end: beige IS a real product of ours, just not this one. The
        // company-wide directive says to offer the way out, but a prompt only managed
        // it about half the time (gc-color-que-no-existe flipped between runs), so the
        // answer is deterministic here. Only the SHADELESS roll flow is ground cover —
        // the Raschel rolls carry a shade % in their family names.
        // "área verde" / "zona verde" is landscaping talk, not a colour request, and is
        // the single most likely false positive in this realm, so it is stripped first.
        if (carried.size === 0 && !dims) {
          const msgNoGreenArea = msgN.replace(/\b(areas?|zonas?|espacios?)\s+verdes?\b/g, " ");
          const other = msgNoGreenArea.match(/\b(beige|verde|gris|azul|cafe|terracota|vino)\b/);
          if (other) {
            const c = other[1];
            return ret(
              `En ground cover solo lo manejamos en negro y blanco, en ${c} no. Si lo que buscas en ${c} es malla sombra, esa sí la tenemos — dime la medida que necesitas y te la cotizo. 😊`,
              { gcColorNotCarried: c }
            );
          }
        }

        // (a0) "¿QUÉ MEDIDAS ESTÁN DISPONIBLES?" — GROUND COVER. Reported 2026-10-23:
        // the customer asked exactly that and got "dime qué largo necesitas o qué área
        // quieres cubrir", so a human had to come in and type the catalogue by hand.
        // Ground cover is a SHORT, FIXED catalogue (2 widths × 4 lengths, negro and
        // blanco), so offer it instead of asking an open measure question — the same
        // rule the borde campaign states. Shades are what make the Raschel rollo
        // catalogue too long to list, so this fires only on the shadeless flow.
        const asksWhichSizes =
          /\b(qu[eé]|cu[aá]l(es)?)\b[^?]*\b(medidas?|tama[nñ]os?|presentaci[oó]n(es)?|dimensiones?|anchos?|largos?|rollos?|opciones?)\b/i.test(msg) ||
          /\b(medidas?|tama[nñ]os?|presentaciones?|anchos?|largos?)\s+(disponibles?|manejan|tienen|hay|existen)\b/i.test(msg) ||
          /\b(qu[eé]|cu[aá]les)\s+(medidas?|tama[nñ]os?)\b/i.test(msg);
        // A bare price ask with no measure belongs here too: "¿Cuál es el precio?" got
        // "¿me dices qué largo necesitas o qué área quieres cubrir?" and a human had to
        // step in and paste the catalogue (reported same day). Offer the options and
        // their prices — unless the message asks something else, which the turn answers.
        const asksBroadPrice =
          /\b(precio|precios|costo|costos|cu[aá]nto\s+(cuesta|cuestan|sale|vale|valen)|cotiz\w*|a\s+c[oó]mo)\b/i.test(msg) &&
          !/\b(env[ií]o|entrega|tarda|llega|paga|pago|tarjeta|factur|garant|instalaci|ubicaci|direcci|sucursal|mayoreo|descuento)\b/i.test(msg);
        // (a0-bis) A bare PRICE ask is not a bare SIZE ask. "¿Qué medidas manejan?" wants
        // the catalogue, so the range list below is the right answer. "¿Cuál es el precio?"
        // wants NUMBERS, and the range list makes the customer pick a size before getting
        // one — which is how psid 28529106973427095 stalled until Noemi stepped in and sent
        // the two full rolls with their exact prices. The client's rule: once we are talking
        // ROLLS the options narrow to about two, so quote them all. For ground cover the full
        // rolls are exactly 2 m x 100 m and 4 m x 100 m; the 10/25/50 m cuts get one clause,
        // not a listing. Prices come from resolvePrice, so the ROLLO COMPLETO rule applies
        // (sheet + IVA, no ML link, asesor closes it and quotes the freight).
        // "¿Qué precio tienen los rollos?" trips asksWhichSizes, because that pattern
        // accepts "rollos"/"opciones" as the thing being asked about — but it is a PRICE
        // question, and it is the client's own example of the case that must quote. So the
        // size list only wins when the message names the SIZES themselves.
        const asksSizesStrict =
          /\b(medidas?|tama[nñ]os?|presentaci[oó]n(es)?|dimensiones?|anchos?|largos?)\b/i.test(msg);
        if (asksBroadPrice && !asksSizesStrict && !dims && carried.size === 0 && rolloFams.length) {
          try {
            let frontierF = rolloFams.map((f) => String(f.id)).filter(Boolean);
            const leavesF = [];
            for (let d = 0; d < 5 && frontierF.length; d++) {
              const kids = await PF.find({ parentId: { $in: frontierF } }).lean().catch(() => []);
              if (!kids.length) break;
              leavesF.push(...kids.filter((k) => k.sellable === true));
              frontierF = kids.map((k) => String(k._id));
            }
            const fullRolls = leavesF.filter((k) => Number(k.attributes?.length) === 100);
            // One quote per WIDTH: negro and blanco are separate leaves at the same price,
            // so quoting both colours would print the same number twice.
            const byW = new Map();
            for (const k of fullRolls) {
              const w = String(k.attributes?.width || "");
              if (!w || byW.has(w)) continue;
              byW.set(w, k);
            }
            const widths = [...byW.keys()].sort((a, b) => Number(a) - Number(b));
            const rowsF = [];
            const shorter = new Set();
            for (const k of leavesF) {
              const l = Number(k.attributes?.length);
              if (l && l !== 100) shorter.add(l);
            }
            for (const w of widths) {
              const pi = await resolvePrice(byW.get(w), altOpt(state, byW.get(w))).catch(() => null);
              if (!pi || pi.amount == null) continue;
              rowsF.push(`• Rollo de ${w} x 100 m: ${fmtMoney(pi)}`);
            }
            if (rowsF.length >= 1) {
              const cuts = [...shorter].sort((a, b) => a - b);
              const cutLine = cuts.length
                ? ` Si necesitas menos, también lo cortamos en ${cuts.join(", ")} m.`
                : "";
              return beginHandoff({
                preface:
                  `El ground cover (malla antimaleza) va en rollo completo, negro o blanco al mismo precio:\n` +
                  `${rowsF.join("\n")}\n` +
                  `Es tejido cerrado para que no crezca la maleza.${cutLine}`,
                reason: `Precio de ground cover sin medida: cotizados los ${rowsF.length} rollos completos; el asesor cierra la venta y cotiza el envío`,
              });
            }
          } catch (e) {
            console.error("\u26a0\ufe0f ground cover full-roll quote failed:", e.message);
          }
        }
        if ((asksWhichSizes || asksBroadPrice) && !dims && carried.size === 0 && rolloFams.length) {
          try {
            let frontierS = rolloFams.map((f) => String(f.id)).filter(Boolean);
            const leavesS = [];
            for (let d = 0; d < 5 && frontierS.length; d++) {
              const kids = await PF.find({ parentId: { $in: frontierS } }).lean().catch(() => []);
              if (!kids.length) break;
              leavesS.push(...kids.filter((k) => k.sellable === true));
              frontierS = kids.map((k) => String(k._id));
            }
            const byWidth = new Map();
            for (const k of leavesS) {
              const w = String(k.attributes?.width || "");
              const l = String(k.attributes?.length || "");
              if (!w || !l) continue;
              if (!byWidth.has(w)) byWidth.set(w, new Map());
              const m = byWidth.get(w);
              if (!m.has(l)) m.set(l, []);
              m.get(l).push(k);
            }
            // Live price for the cheapest and the dearest of each width — the ends of
            // the range only, so the overview stays one ML round-trip per corner
            // instead of one per SKU, and every number in it is a live number.
            const edgePrice = async (docs, pickMax) => {
              let best = null;
              for (const d of docs) {
                const pi = await resolvePrice(d, altOpt(state, d)).catch(() => null);
                if (!pi || !pi.amount) continue;
                if (best == null || (pickMax ? pi.amount > best : pi.amount < best)) best = pi.amount;
              }
              return best;
            };
            const rowsS = [];
            for (const w of [...byWidth.keys()].sort((a, b) => Number(a) - Number(b))) {
              const lens = [...byWidth.get(w).keys()].sort((a, b) => Number(a) - Number(b));
              if (!lens.length) continue;
              const lo = await edgePrice(byWidth.get(w).get(lens[0]), false);
              const hi = await edgePrice(byWidth.get(w).get(lens[lens.length - 1]), true);
              const money = (v) => (Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`);
              const range = lo && hi ? ` — desde ${money(lo)} (${w}x${lens[0]} m) hasta ${money(hi)} (${w}x${lens[lens.length - 1]} m)` : "";
              rowsS.push(`• ${w} m de ancho: ${lens.join(", ")} m${range}`);
            }
            if (rowsS.length) {
              return ret(
                `El ground cover (malla antimaleza) lo manejamos en negro y blanco, en estas medidas:\n${rowsS.join("\n")}\n` +
                  `¿Cuál de estas te sirve? Te paso el precio exacto y el enlace de compra. 😊`,
                { gcSizesListed: rowsS.length }
              );
            }
          } catch (e) {
            console.error("⚠️ ground cover size list failed:", e.message);
          }
        }
        // (a1) AN AREA WITH NO SIDES ("200 m2", "necesito cubrir 200 metros cuadrados").
        // The roll flow is the one that ASKS for the area, so it has to be able to act
        // on one: recommend the nearest real roll. Reported: "Necesito cubrir 200 m2"
        // got "dime de cuánto por cuánto lo quieres cubrir" when 4x50 m covers it
        // exactly. (The confeccionada flow is the opposite case — there a measure is
        // width × length and refusing to guess from an area is correct.)
        const areaOnlyM = !dims && msg.match(/\b(\d{1,5}(?:[.,]\d+)?)\s*(?:m2|m²|metros?\s+cuadrados?|mts?\s+cuadrados?)\b/i);
        if (areaOnlyM) {
          const areaV = Number(String(areaOnlyM[1]).replace(",", "."));
          if (Number.isFinite(areaV) && areaV > 0 && (reqShade || carried.size === 0)) {
            return await recommend(areaV, reqShade);
          }
        }
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
            return beginHandoff({ preface: `De acuerdo.`, reason: `Cliente no aceptó el rollo recomendado — buscar mejor solución con un asesor` });
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
          state.lead = { ...(state.lead || {}), wholesaleQty: String(qty) };
          return beginHandoff({ preface: `Para ${qty} rollos manejamos precio de MAYOREO.`, reason: `Mayoreo: ${qty} rollos — precio y cierre con un especialista`, wholesale: true });
        }

        // (c) MEASURE GIVEN — but a 2-D measure is only a ROLL if it COULD be one
        // here. Every roll in this flow is at least as long as the shortest length we
        // stock, so a measure whose longest side falls under that is a confeccionada
        // PANEL, not a roll, and reading it as an area to cover strands the customer in
        // the wrong flow. Reported 2026-10-24 (psid 29364210186519165): "3 × 4" on the
        // Ground Cover ad was answered "¿el área que buscas cubrir es de 12 m²?"; "Beige"
        // then dead-ended on "aquí solo hay negro y blanco", and a "Si" two turns later
        // bought him a quote for a 2x100 m negro roll he never asked for. Leaving the
        // turn unclaimed lets §1.5 switch him to malla sombra, where 4x3 m is real.
        let notARoll = false;
        if (dims) {
          const minLen = await shortestRollLength();
          if (minLen && Math.max(dims[0], dims[1]) < minLen) notARoll = true;
        }
        rollFlowRejectedMeasure = notARoll;
        if (dims && !notARoll) {
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
            const pi = await resolvePrice(exact, altOpt(state, exact));
            if (pi && pi.amount) {
              const sh = await shadeText(exact);
              state.activeProductId = String(exact._id);
              if (flowHasShades) {
                // RASCHEL ROLLO — the client's promo format: IVA-incluido header, the
                // requested roll(s) with "+ envío" (rolls are quoted with shipping
                // separate, no online link), a mayoreo note, and the store line. qty
                // UNKNOWN → ASK how many BEFORE closing (mirrors borde): a bare-number
                // reply next turn is read as the roll count (2+ → mayoreo handoff). If
                // they already said "un rollo" (qty===1) we don't re-ask.
                const quote = rollPromoQuote(sh, [{ w: dims[0], l: dims[1], price: pi.amount }]);
                if (qty == null) {
                  state.awaitingRollQty = true;
                  return ret(`${quote}\n\n¿Cuántos rollos necesitas? 😊`, { rollQuoted: `${dims[0]}x${dims[1]}`, rollAskQty: true });
                }
                return ret(quote, { rollQuoted: `${dims[0]}x${dims[1]}` });
              }
              // GROUND COVER (malla antimaleza) — a real ML product WITH a buy link (NOT
              // the Raschel-roll "+ envío / no link" format) and NO shade %. Quote price
              // + link DIRECTLY (reported: it was mislabeled "Malla Sombra Raschel" via
              // rollPromoQuote and withheld the link until turn 2).
              // "+ IVA" comes from resolvePrice, never hardcoded: the catalogue price
              // excludes tax but the LIVE ML price we actually quote already includes
              // it, so stamping "+ IVA" here billed the customer 16% twice.
              // ROLLO COMPLETO (2 m / 4 m x 100 m): our price sheet with IVA in, no
              // buy link, and an asesor closes it and quotes the freight. Reported
              // five times in two days — the ML listing charged $5,314 for the
              // 4x100 m while the direct price is $4,222.40, and the customer who
              // saw both replied "juegan con sus precios".
              if (pi.fullRoll) {
                state.activeProductId = String(exact._id);
                state.awaitingRollQty = false; // the asesor takes the quantity
                // The color belongs in this reply too. On the FULL ROLLS negro and blanco
                // really are the same price (both come off the price sheet), so naming a
                // measure must not leave the customer thinking there is only one color —
                // the bare-price answer already says "negro o blanco al mismo precio" and
                // this path, reached by naming 4x100, said nothing about color at all.
                const ccFR = await colorChoiceForProduct(exact, {
                  self: pi,
                  resolve: (d) => resolvePrice(d, altOpt(state, d)),
                  link: () => null, // full rolls carry no buy link by rule
                });
                const ctFR = colorChoiceText(ccFR);
                return beginHandoff({
                  preface:
                    `¡Claro! El ground cover (malla antimaleza) de ${dims[0]} x ${dims[1]} m está en ${fmtMoney(pi)}${ctFR.suffix}.` +
                    (ctFR.suffix ? "" : ctFR.lines ? `\n${ctFR.lines}` : "") +
                    ` El rollo completo lo cotiza un asesor junto con el envío.`,
                  reason: pi.handoffReason || `Rollo completo ${dims[0]}x${dims[1]} — cerrar con un asesor`,
                });
              }
              const discOf = (q) => (q.hasDiscount && Number.isFinite(q.originalPrice) && q.originalPrice > q.amount ? `, rebajado de $${Math.round(q.originalPrice)}` : "");
              const mkLink = (q, d) => trackedLink(q.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: d ? d.name : exact.name, productId: String((d || exact)._id) });
              const ccGC = await colorChoiceForProduct(exact, { self: pi, resolve: (d) => resolvePrice(d, altOpt(state, d)), link: mkLink });
              const ctGC = colorChoiceText(ccGC);
              state.awaitingRollQty = true; // a 2+ reply next turn → mayoreo handoff
              if (ccGC) {
                // Same price ⇒ SHARE IT and name the colors. Different price ⇒ ASK which
                // color, because here the color IS the price and we cannot quote without
                // it. The reply must not lead with one color's number and list another
                // underneath ("está en $1531.20: • Negro $1531.20 • Blanco $1749" reads as
                // a contradiction), nor assert the resolved color's price as THE price.
                if (ctGC.ask) {
                  state.awaitingRollQty = false; // the color comes first, the quantity after
                  return ret(
                    `El ground cover (malla antimaleza) de ${dims[0]} x ${dims[1]} m lo tenemos en ${ctGC.colorsOr}, ${ctGC.ask}`,
                    { gcColorAsk: `${dims[0]}x${dims[1]}`, gcColorsDiffer: ccGC.variants.length }
                  );
                }
                return ret(
                  `¡Claro! El ground cover (malla antimaleza) de ${dims[0]} x ${dims[1]} m está en ${fmtMoney(pi)}${ctGC.suffix}.` +
                    (ctGC.lines ? `\n${ctGC.lines}` : "") +
                    `\n¿Cuántos necesitas? 😊`,
                  { gcQuoted: `${dims[0]}x${dims[1]}`, gcColorsOffered: ccGC.variants.length }
                );
              }
              const link = await mkLink(pi, exact);
              return ret(
                `¡Claro! El ground cover (malla antimaleza) de ${dims[0]} x ${dims[1]} m está en ${fmtMoney(pi)}${discOf(pi)}.` + (link ? ` Aquí lo compras: ${link}` : "") + ` ¿Cuántos necesitas? 😊`,
                { gcQuoted: `${dims[0]}x${dims[1]}` }
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
      const { resolvePrice, trackedLink, fmtMoney } = require("./priceResolver");
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
        const pi = await resolvePrice(doc, altOpt(state, doc));
        if (pi && pi.amount && !pi.handoff) {
          const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: doc.name, productId: String(doc._id) });
          state.activeProductId = String(doc._id);
          return ret(`El ${label} cuesta $${pi.amount}.` + (link ? ` Aquí lo puedes comprar: ${link}` : "") + ` ¿Te ayudo con algo más? 😊`, { complementQuoted: label });
        }
        return beginHandoff({ preface: `Para confirmarte el precio del ${label},`, reason: `Complemento "${label}" sin precio en línea` });
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
    // The borde gates below fire on generic words ("precio", "ancho", a bare number). If the
    // customer clearly names a DIFFERENT active product (antimaleza/ground cover/malla sombra/
    // raschel/monofilamento/anti-áfido/anti-granizo), do NOT intercept as borde — fall through
    // so the flow-switch (§1.5) can route them to that flow. Reported: antimaleza & malla-sombra
    // rollo asks were dragged onto borde ("¿qué largo?") because "precio"/"ancho" matched here.
    // This only YIELDS to §1.5's AI scope classifier — it never forces a switch, so a genuine
    // borde customer who merely mentions another product still gets classified as "current".
    const wantsNonBordeProduct = /(anti\s*malez|ground\s*cover|malla\s*(de\s*)?sombra|raschel|monofilament|anti\s*[aá]fido|anti\s*granizo|sombreo)/i.test(String(userMessage));
    // A DELIVERY/logistics question ("¿en cuántos días me llega?", "¿cuándo llega?",
    // "tiempo de entrega") must NOT be treated as a borde inquiry — the ask-length gate's
    // trigger matches "cuánto" inside "cuántos días" and answered a shipping question with
    // "¿qué largo necesitas?" (reported). Yield so the turn answers about delivery instead.
    const isDeliveryQuestion = /(cu[aá]nto?s?\s+d[ií]as|cu[aá]ndo\s+(me\s+)?(llega|lleg[ao]|entregan|sale)|tiempo\s+de\s+(entrega|env[ií]o)|en\s+cu[aá]nto\s+(tiempo|llega)|d[ií]as?\s+(en\s+)?(llega|entrega|env)|cu[aá]nto\s+tarda|rastreo|paqueter[ií]a|gu[ií]a\s+de\s+env)/i.test(String(userMessage));
    // ASKING FOR OUR CONTACT, not about borde. This gate runs long before the phone
    // gate, and the word-number map read the "un" in "facilitarme un num" as quantity
    // 1 — so a customer who asked for a phone number got "¡Perfecto, 1! ¿De cuál largo
    // los quieres?" (reported). Yield so the contact gate answers him.
    const isContactRequest =
      /\b(num(ero)?s?|tel(efono|éfono)?s?|cel(ular)?|whats?app?|wasap|wpp|contacto|marcar|llamar|hablar|comunicar\w*)\b/i.test(String(userMessage)) &&
      !/\bmi\s+(num|tel|cel|whats)/i.test(String(userMessage));
    if (userMessage && isBordeFlow && !wantsNonBordeProduct && !isDeliveryQuestion && !isContactRequest) {
      const { findProductInFamilies } = require("./tools");
      const { resolvePrice, trackedLink, fmtMoney } = require("./priceResolver");
      const PFm = require("../../models/ProductFamily");
      const msgB = String(userMessage);
      // The gates below own the whole turn, so a second question riding along in the
      // same message used to vanish: "Solo ocupo uno!! / Dónde están ubicados? / O
      // donde lo hacen llegar?" got a purchase link and a CP ask, and the address was
      // never shared (reported 2026-10-23). Answer the roll AND say where we are.
      const bordeLocParts = asksLocationOrShipping(msgB) ? await locationBlock() : null;
      const withLoc = (reply) => (bordeLocParts && bordeLocParts.length ? `${reply}\n\n${bordeLocParts.join("\n")}` : reply);
      const retB = (reply, extra) => {
        reply = withLoc(reply);
        history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
        return { reply, state: { ...state, history, nodeId: currentNode.id }, diagnostics: { workflow: { id: String(workflow._id), name: workflow.name }, fromNode: { id: currentNode.id, name: currentNode.name }, toNode: { id: currentNode.id, name: currentNode.name }, ...(bordeLocParts ? { locationAnswered: true } : {}), ...extra } };
      };
      // WHAT THE NUMBERS IN THIS MESSAGE MEAN — read ONCE, by one function, and shared
      // by every gate below. This replaces a local parseQty() whose rule was "the first
      // 1-3 digit number is the quantity", plus six ad-hoc guards bolted around it at
      // six different call sites. That arrangement shipped the same bug five times
      // ("6x6" → 6 piezas, "tres por 8" → 8 piezas, "al 90%" → 90 piezas, "el de 18 m"
      // → 18 rollos, "uno de 6 y uno de 18" → 6 rollos de 18): each fix guarded ONE
      // site and the next phrasing slipped past it at another. A number's meaning is a
      // property of the message, not of the gate reading it.
      // Rules and the full regression list: ai/workflow/bordeOrder.js
      // Deterministic test (no DB, no LLM): node scripts/bordeOrderTest.js
      const { readBordeMessage } = require("./bordeOrder");
      const readMsg = (o = {}) => readBordeMessage(msgB, o);
      const rMsg = readMsg(); // no pending roll in context — the gates that have one re-read with it

      // THE CATALOGUE, in the client's own vocabulary. Four presentations, two
      // versions: Premium is the grueso (3 mm), Flexible the delgado (1.5 mm).
      // Customers use either name, so every variant read goes through detectVariant
      // and the choice sticks on state for the rest of the chat.
      const BORDE_LENS = ["6", "9", "18", "54"];
      const VARIANT_LABEL = { grueso: "Premium", delgado: "Flexible" };
      const VARIANT_SPEC = { grueso: "Premium (grueso, 3 mm)", delgado: "Flexible (delgado, 1.5 mm)" };
      // Naming BOTH versions in one message is normal speech and it is not ambiguous:
      // "en verdad está mejor el premium / que el flexible" names the one they want and
      // then the one they are dismissing. Testing delgado first turned that customer
      // into a Flexible buyer and we quoted him the wrong roll (reported 2026-10-23).
      // So: drop rejected/comparative mentions, and if both survive take the FIRST.
      const detectVariant = (s) => {
        const pick = (txt) => {
          const d = txt.search(/\b(?:delgad\w*|flexible)/i);
          const g = txt.search(/\b(?:grues\w*|premium)/i);
          if (d < 0 && g < 0) return null;
          if (d < 0) return "grueso";
          if (g < 0) return "delgado";
          return d < g ? "delgado" : "grueso";
        };
        const kept = String(s || "")
          // "no quiero el delgado", "no me sirve el premium"
          .replace(/\bno\s+(?:quiero|busco|me\s+sirve|es|ser[ií]a|ese|est[ée])?\s*(?:el|la|lo)?\s*(?:delgad\w*|flexible|grues\w*|premium)\b/gi, " ")
          // "… mejor el premium QUE el flexible", "… el grueso EN VEZ DEL delgado"
          .replace(/\b(?:que|en\s+vez\s+del?|en\s+lugar\s+del?|y\s+no)\s+[^.,;!?¡¿\n]*$/i, " ");
        const picked = pick(kept);
        if (picked) return picked;
        // Nothing survived the stripper, so the only version word in this message was
        // a rejected or comparative one. The raw-text fallback exists for an
        // over-eager strip, but a message that OPENS with the comparative marker is
        // the tail of the previous sentence ("Y en verdad está mejor el premium" /
        // "Que el flexible"): it names the version being dismissed, and falling back
        // flipped that customer to Flexible two turns after he chose Premium
        // (reported 2026-10-23). No variant named this turn → the chosen one stands.
        if (/^[\s,.;]*(?:que|y\s+no|en\s+vez|en\s+lugar)\b/i.test(String(s || ""))) return null;
        return pick(String(s || ""));
      };
      const msgVariant = detectVariant(msgB);
      if (msgVariant) state.bordeVariant = msgVariant;
      // The version we KNOW (named this turn or earlier) — or null. Never guessed:
      // defaulting silently quoted Premium prices to Flexible buyers.
      const variantKnown = () => msgVariant || state.bordeVariant || null;
      const VARIANT_FALLBACK = "grueso";
      // THE GRUESO IS THE ONLY PRICE WE VOLUNTEER (2026-10-26, the client's call).
      // The ad sells the "Borde Separador GRUESO" and the Flexible is $39-$220
      // cheaper, so the two-column menu answered "Precio por favor" with a price
      // comparison against ourselves — the customer's next words were "no lo sé"
      // (reported: Alejandra Mora). The Flexible price goes out ONLY when the customer
      // asks for something cheaper or names that version themselves, which is what
      // this flow's own node prompts have said all along ("Ofrece el GRUESO POR
      // DEFECTO. Menciona el DELGADO ÚNICAMENTE si el cliente lo pide"): the gates
      // here are newer than those prompts and were overruling them — gates beat
      // prompts, so a rule written only in a prompt is not in force.
      // Second reason: the 6 and 9 m Flexible have NO live Mercado Libre listing, so
      // half the column we were quoting could not be bought online at all.
      const asksCheaper =
        /\b(?:barat\w+|econ[oó]mic\w+|accesible\w*|descuentos?|rebaja\w*|car[oa]s?|mejor(?:es)?\s+precios?)\b/i.test(msgB) ||
        /\bprecio\s+m[aá]s\s+(?:bajo|accesible)\b/i.test(msgB) ||
        /\botra\s+(?:opci[oó]n|versi[oó]n)\b/i.test(msgB);
      // An explicit question about the VERSIONS is the other trigger the client's own
      // node prompts name ("si pregunta por las variedades/opciones que manejamos").
      // It must name the variant dimension — a generic "¿qué opciones hay?" is a
      // question about the four LENGTHS and gets the grueso list.
      const asksVersions = /\b(?:qu[eé]|cu[aá]ntas|cu[aá]les)\s+(?:versiones|presentaciones|variedades|grosores)\b/i.test(msgB);
      const flexAsked = asksCheaper || asksVersions;
      if (flexAsked || msgVariant === "delgado") state.bordeShowFlexible = true;
      // Sticky: once the comparison is on the table it stays, so the follow-up turns
      // can still talk about either version.
      const showFlex = () => !!state.bordeShowFlexible;
      // Offer the options, never ask an open "¿qué largo necesitas?" — used only when
      // no price resolves, so the customer still sees what exists.
      const bordeMenuFallback = () =>
        showFlex()
          ? `Lo manejo en rollos de 6, 9, 18 y 54 m, en versión ${VARIANT_SPEC.grueso} y ${VARIANT_SPEC.delgado}. ¿Cuál te sirve? 😊`
          : `Lo manejo en rollos de 6, 9, 18 y 54 m (borde grueso, 3 mm). ¿Cuál te sirve? 😊`;
      // CLIENT THRESHOLDS, from §2.A / §3.2 / §5 of the campaign document. The
      // profile is decided by PIECES PER PRESENTATION, not by linear metres:
      //   individual  → up to TWO pieces of 6, 9 or 18 m, or ONE roll of 54 m:
      //                 price + Mercado Libre link, self-serve, no asesor.
      //   mayoreo     → THREE OR MORE pieces of 18 m, MORE THAN ONE roll of 54 m,
      //                 or an explicit ask about volume prices/conditions: share the
      //                 reference price, then capture data for an asesor.
      // An earlier draft of the spec used ≤25 m / ≥50 m linear metres; this full
      // document supersedes it, and the two disagree in practice — 2 rolls of 18 m
      // (36 m) is individual here but escalated under the metre rule, and §3.2 warns
      // explicitly not to read every multi-piece order as wholesale.
      // Reference price for N rolls of this length. The client's rule: ALWAYS give
      // a number on the mayoreo path (it's what separates real prospects from
      // browsers) while making clear the final volume price comes from an asesor.
      const refPrice = async (len, n) => {
        try {
          const byLenR = await bordeLeavesByLength(variantKnown() || VARIANT_FALLBACK);
          const leaf = byLenR.get(String(len));
          const pi = leaf ? await resolvePrice(leaf, altOpt(state, leaf)) : null;
          if (!pi || !pi.amount) return null;
          return { unit: pi.amount, total: Math.round(pi.amount * n * 100) / 100 };
        } catch { return null; }
      };
      const mayoreo = async (n, len) => {
        state.lead = { ...(state.lead || {}), wholesaleQty: String(n) };
        state.bordeWholesaleTrack = true;
        if (len) state.bordeWholesaleLen = String(len);
        const meters = len ? Number(len) * n : null;
        // Same rule as the retail quotes: with the Flexible off the table the grueso
        // IS the reference price — listing both here turned a 20-roll lead into a
        // side-by-side comparison of our own two price lists.
        const vMay = variantKnown() || (showFlex() ? null : VARIANT_FALLBACK);
        // Reference price first, asesor second — never a volume price we can't honor.
        // With no version named we must not silently price one of the two: give both,
        // clearly as reference, and let the asesor settle it.
        let priceLine = "";
        if (len && vMay) {
          const ref = await refPrice(len, n);
          const vLabM = showFlex() ? ` ${VARIANT_LABEL[vMay]}` : "";
          if (ref) priceLine = ` De referencia, el rollo${vLabM} de ${len} m está en $${ref.unit} c/u (${n} = $${ref.total}); el precio de mayoreo lo confirma un asesor.`;
        } else if (len) {
          const both = [];
          for (const variant of ["grueso", "delgado"]) {
            const byLen = await bordeLeavesByLength(variant);
            const leaf = byLen.get(String(len));
            if (!leaf) continue;
            const pi = await resolvePrice(leaf, altOpt(state, leaf)).catch(() => null);
            if (pi && pi.amount) both.push(`${VARIANT_LABEL[variant]} $${pi.amount} c/u (${n} = $${Math.round(pi.amount * n * 100) / 100})`);
          }
          if (both.length) priceLine = ` De referencia, el rollo de ${len} m: ${both.join(" · ")}. El precio de mayoreo y la versión los confirma un asesor.`;
        }
        return beginHandoff({
          preface: `Para ${n} rollo${n === 1 ? "" : "s"} de ${len ? `${len} m` : "borde"}${meters ? ` (${meters} m lineales)` : ""} manejamos precio de MAYOREO.${priceLine}`,
          reason: `Mayoreo borde${vMay ? ` ${VARIANT_LABEL[vMay]}` : ""}: ${n} rollo(s) de ${len || "?"} m${meters ? ` = ${meters} m lineales` : ""}`,
          wholesale: true,
        });
      };
      const shareLink = async (leaf, len, qty = 1) => {
        const pi = await resolvePrice(leaf, altOpt(state, leaf));
        if (!pi || !pi.amount) return null;
        state.bordeWholesaleTrack = false; // an individual sale closed → ML shipping applies again
        const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: leaf.name, productId: String(leaf._id) });
        const vLabS = variantKnown() ? ` ${VARIANT_LABEL[variantKnown()]}` : "";
        const n = Number(qty) > 1 ? Number(qty) : 1;
        // NO LINK = no live listing (54 m Premium, 6/9 m Flexible are all paused on
        // ML). Quoting the price and stopping there is a dead end: the customer can't
        // buy it and no human knows they tried. Quote, then hand off — §3.3 rule 4 of
        // the campaign rules ("cuando el cliente seleccione una opción sujeta a
        // cotización personalizada, solicitar sus datos y canalizar").
        if (!link) {
          // Two different reasons for having no link, and the customer must not be
          // told the wrong one. A ROLLO COMPLETO has no link BY RULE — its listing
          // is live and selling, we simply don't send full rolls there — so saying
          // "no está publicado" would be a plain falsehood. Everything else here
          // really has no active listing (54 m Premium, 6/9 m Flexible were paused).
          const totalTxt = `$${Math.round(pi.amount * n * 100) / 100}`;
          const unitTxt = fmtMoney(pi);
          if (pi.fullRoll) {
            return beginHandoff({
              preface: withLoc(n > 1
                ? `${n} rollos${vLabS} de ${len} m salen en ${totalTxt} (${unitTxt} c/u). El rollo completo lo cotiza un asesor junto con el envío.`
                : `El rollo${vLabS} de ${len} m está en ${unitTxt}. El rollo completo lo cotiza un asesor junto con el envío.`),
              reason: pi.handoffReason || `Rollo completo de ${len} m — cerrar con un asesor`,
            });
          }
          return beginHandoff({
            preface: withLoc(`${n > 1 ? `${n} rollos${vLabS} de ${len} m salen en ${totalTxt} (${unitTxt} c/u), pero ahora mismo no los tenemos` : `El rollo${vLabS} de ${len} m está en ${unitTxt}, pero ahora mismo no lo tenemos`} publicado${n > 1 ? "s" : ""} para compra en línea.`),
            reason: `Borde${vLabS ? vLabS : ""} ${len} m sin publicación activa en Mercado Libre — ${n > 1 ? `${n} piezas ` : ""}cotizado en $${pi.amount} c/u; cerrar la venta con un asesor`,
          });
        }
        return retB(
          n > 1
            ? `¡Perfecto! El rollo${vLabS} de ${len} m está en $${pi.amount}, así que ${n} te salen en $${Math.round(pi.amount * n * 100) / 100}. Aquí los compras (elige cantidad ${n}), con envío gratis: ${link}`
            : `¡Perfecto! El rollo${vLabS} de ${len} m está en $${pi.amount}. Aquí lo compras, con envío gratis: ${link}`,
          { bordeQuoted: len, ...(n > 1 ? { bordeQty: n } : {}) }
        );
      };
      // Borde leaves by LENGTH for one thickness variant. Both variants carry the
      // same length names ("Rollo de 18 m" exists under Grueso AND Delgado), so a
      // text match scores one or the other and a multi-row reply ends up mixing the
      // two price lists. thickness is the real discriminator (3 mm / 1.5 mm).
      let _bordeLeafCache = null;
      const bordeLeavesByLength = async (variant) => {
        if (!_bordeLeafCache) {
          const acc = [];
          let frontier = bordeFams.map((f) => String(f.id)).filter(Boolean);
          for (let d = 0; d < 5 && frontier.length; d++) {
            const kids = await PFm.find({ parentId: { $in: frontier } }).lean().catch(() => []);
            if (!kids.length) break;
            acc.push(...kids.filter((k) => k.sellable === true));
            frontier = kids.map((k) => String(k._id));
          }
          _bordeLeafCache = acc;
        }
        const thick = variant === "delgado" ? "1.5" : "3";
        const sameThick = _bordeLeafCache.filter((k) => String(k.attributes?.thickness || "") === thick);
        const pool = sameThick.length ? sameThick : _bordeLeafCache; // no thickness data → use what exists
        const byLen = new Map();
        for (const k of pool) {
          const L = String(k.attributes?.length || "");
          if (L && !byLen.has(L)) byLen.set(L, k);
        }
        return byLen;
      };

      // THE MENU: the four lengths, GRUESO only — the one price list we volunteer.
      // The client's rule is to offer the available options instead of asking an open
      // question, and there are only four lengths, so this is the default answer to any
      // broad borde ask. The Flexible column is added ONLY once showFlex() is on (the
      // customer asked for something cheaper, or asked which versions we make); the
      // purchase links follow once they pick (the quantity decides self-serve vs asesor).
      const bordeMenu = async () => {
        const byG = await bordeLeavesByLength("grueso");
        const byD = showFlex() ? await bordeLeavesByLength("delgado") : null;
        const cols = byD ? [["grueso", byG], ["delgado", byD]] : [["grueso", byG]];
        const rows = []; const quoted = [];
        for (const len of BORDE_LENS) {
          const parts = [];
          for (const [variant, byLen] of cols) {
            const leaf = byLen.get(len);
            if (!leaf) continue;
            const pi = await resolvePrice(leaf, altOpt(state, leaf)).catch(() => null);
            if (pi && pi.amount) parts.push(`${byD ? `${VARIANT_LABEL[variant]} ` : ""}$${pi.amount}`);
          }
          if (parts.length) { rows.push(`• ${len} m — ${parts.join(" · ")}`); quoted.push(len); }
        }
        if (!rows.length) return null;
        return {
          quoted,
          rows,
          text: byD
            ? `¡Claro! El borde separador va por rollo, en 4 medidas y 2 versiones:\n${rows.join("\n")}\n` +
              `Premium es el grueso (3 mm) y Flexible el delgado (1.5 mm). ¿Cuál te sirve? 😊`
            // No second version to explain here, so no explainer line — and the
            // width gate prefixes this menu with the 13 cm, which repeated it.
            : `¡Claro! El borde separador grueso (3 mm) va por rollo, en 4 medidas:\n${rows.join("\n")}\n¿Cuál te sirve? 😊`,
        };
      };

      // ONE length, BOTH versions, priced — the answer to a length named by someone
      // who has asked for a cheaper option, so the two numbers settle it instead of
      // another question ("de 6 en cuánto sale" used to get no price at all). Returns
      // null while the Flexible is off the table, and every caller falls through to
      // the plain grueso quote.
      const bordeBothVersions = async (len) => {
        if (!showFlex()) return null;
        const parts = [];
        for (const variant of ["grueso", "delgado"]) {
          const byLen = await bordeLeavesByLength(variant);
          const leaf = byLen.get(String(len));
          if (!leaf) continue;
          const pi = await resolvePrice(leaf, altOpt(state, leaf)).catch(() => null);
          if (pi && pi.amount) parts.push(`${VARIANT_LABEL[variant]} $${pi.amount}`);
        }
        if (parts.length < 2) return null;
        return `El rollo de ${len} m lo tenemos en dos versiones: ${parts.join(" · ")}. ` +
          `Premium es el grueso (3 mm) y Flexible el delgado (1.5 mm). ¿Cuál te sirve? 😊`;
      };

      // ONE version, four lengths, each with its price and purchase link — the
      // client's flow-2 second message. Fires once the customer names the version.
      const bordeVersionList = async (variant) => {
        const byLen = await bordeLeavesByLength(variant);
        const rows = []; const quoted = []; const linked = [];
        for (const len of BORDE_LENS) {
          const leaf = byLen.get(len);
          if (!leaf) continue;
          const pi = await resolvePrice(leaf, altOpt(state, leaf)).catch(() => null);
          if (!pi || !pi.amount) continue;
          const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: leaf.name, productId: String(leaf._id) });
          rows.push(`• ${len} m: $${pi.amount}${link ? ` → ${link}` : ""}`);
          quoted.push(len);
          if (link) linked.push(len);
        }
        if (!rows.length) return null;
        // A length with no live listing shows its price but no link. Saying "todos con
        // envío gratis" after it reads as an oversight, so name the exception instead.
        const noLink = quoted.filter((l) => !linked.includes(l));
        const shipLine = noLink.length
          ? `Los que llevan enlace son compra directa con envío gratis; ${noLink.map((l) => l + " m").join(" y ")} ${noLink.length === 1 ? "lo surtimos" : "los surtimos"} con un asesor.`
          : `Todos con envío gratis vía Mercado Libre.`;
        return {
          quoted,
          text:
            `¡Excelente! El borde ${showFlex() ? VARIANT_LABEL[variant] : "separador grueso (3 mm)"} está disponible en:\n${rows.join("\n")}\n` +
            `${shipLine} ¿Cuántos metros necesitas? 😊`,
        };
      };

      // The profile decision, in one place.
      const isRetailOrder = (len, n) => {
        const L = Number(len), N = Number(n);
        if (!Number.isFinite(L) || !Number.isFinite(N) || N < 1) return false;
        if (L >= 54) return N <= 1; // more than one full roll → mayoreo
        return N <= 2;              // 6, 9, 18 m: up to two pieces is individual
      };
      // Every model-authored borde turn carries the vocabulary and the ban on open
      // measure questions — the gates below cover the common shapes, but when the turn
      // reaches the model it must still OFFER the options rather than ask for one.
      earlyFacts.push(
        `- BORDE SEPARADOR: 4 medidas (rollos de 6, 9, 18 y 54 m, alto fijo 13 cm). ` +
          `COTIZA SIEMPRE la versión ${VARIANT_SPEC.grueso}: es la única cuyo precio ofrecemos por iniciativa propia. ` +
          (showFlex()
            ? `El cliente ya pidió una opción más económica, así que aquí SÍ puedes dar el precio de la versión ${VARIANT_SPEC.delgado}.`
            : `NUNCA menciones ni cotices la versión delgada/Flexible: su precio se comparte SOLO si el cliente pide algo más económico o la nombra él mismo.`) +
          ` PROHIBIDO preguntar "¿qué largo necesitas?" o cualquier pregunta abierta de medida: SIEMPRE ofrece las medidas disponibles con su precio. ` +
          `Comparte precios desde el primer intercambio; las compras individuales en Mercado Libre llevan envío gratis.`
      );
      // §3.5 — SHIPPING FOR A MAYOREO LEAD. "El envío va incluido cuando compras por
      // Mercado Libre" is the INDIVIDUAL-purchase answer; a volume order moves by
      // freight and the rules say to capture the código postal and the contact data so
      // an asesor can price it. The model gave the Mercado Libre answer to a customer
      // who had just asked for 50 rolls of 18 m, which quietly promises free shipping
      // on an order that doesn't ship that way.
      const asksShippingCost =
        /env[ií]o|flete|paqueter[ií]a|transporte/i.test(msgB) &&
        /(cu[aá]nto|costo|cuesta|precio|cobran|sale|vale|gratis|incluido|incluye|manejan|tiene)/i.test(msgB);
      if (asksShippingCost && (state.bordeWholesaleTrack || (state.pendingHandoff && state.pendingHandoff.wholesale))) {
        const haveZipS = !!(state.location && (state.location.zip || state.location.zipcode));
        return retB(
          `En pedidos de mayoreo el envío se cotiza por volumen y destino, así que lo calcula tu asesor. ` +
            (haveZipS
              ? `Ya tengo tu código postal; en cuanto me confirmes tu nombre y un teléfono a 10 dígitos te pasan el costo exacto. 🚚`
              : `¿Me compartes tu código postal, tu nombre y un teléfono a 10 dígitos? Con eso te dan el costo exacto. 🚚`),
          { bordeWholesaleShipping: true }
        );
      }
      // AN ORDER OF SEVERAL PRESENTATIONS AT ONCE ("uno de 6 y uno de 18" — the
      // client's flow-1). Each line gets its own price and purchase link, because the
      // rules count PIECES PER PRESENTATION: 1×6 + 1×18 is two individual pieces, not
      // a wholesale order. Returns null when no line resolves, so callers can fall back.
      const bordeOrderReply = async (variant, pairs) => {
        const byLenO = await bordeLeavesByLength(variant);
        const rows = []; const noLink = []; let total = 0;
        for (const p of pairs) {
          const leaf = byLenO.get(String(p.len));
          if (!leaf) continue;
          const pi = await resolvePrice(leaf, altOpt(state, leaf)).catch(() => null);
          if (!pi || !pi.amount) continue;
          const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: leaf.name, productId: String(leaf._id) });
          const sub = Math.round(pi.amount * p.qty * 100) / 100;
          total += sub;
          rows.push(`• ${p.qty} × ${p.len} m: $${pi.amount} c/u${p.qty > 1 ? ` = $${sub}` : ""}${link ? ` → ${link}` : ""}`);
          if (!link) noLink.push(`${p.len} m`);
        }
        if (!rows.length) return null;
        return { rows, total: Math.round(total * 100) / 100, noLink };
      };
      // Send a fully-resolved retail order: one line per presentation, with links.
      const sendBordeOrder = async (variant, pairs) => {
        const q = await bordeOrderReply(variant, pairs);
        if (!q) return null;
        state.bordeWholesaleTrack = false; // individual order → ML free shipping applies
        const head = showFlex()
          ? `¡Perfecto! Te comparto los precios y enlaces de compra en versión ${VARIANT_LABEL[variant]}:`
          : `¡Perfecto! Te comparto los precios y enlaces de compra:`;
        // A line with no live listing can't be bought online. Quote everything, then
        // hand off for the part we can't close — §3.3 rule 4.
        if (q.noLink.length) {
          return beginHandoff({
            preface: `${head}\n${q.rows.join("\n")}\nTotal $${q.total}. ${q.noLink.join(" y ")} no ${q.noLink.length === 1 ? "está" : "están"} publicado${q.noLink.length === 1 ? "" : "s"} para compra en línea.`,
            reason: `Borde ${VARIANT_LABEL[variant]} — pedido ${pairs.map((p) => `${p.qty}×${p.len} m`).join(" + ")}; sin publicación activa: ${q.noLink.join(", ")}`,
          });
        }
        return retB(`${head}\n${q.rows.join("\n")}\nTotal $${q.total}, todos con envío gratis vía Mercado Libre. 😊`, {
          bordeOrderQuoted: pairs.map((p) => `${p.qty}x${p.len}`),
        });
      };
      // A WIDTH/HEIGHT QUESTION, recognised BEFORE anything reads a number as a count.
      // "10 cm de ancho, me gusta que sobre" came back as "10 rollos de 54 m → MAYOREO":
      // the pending-version gate took the 10 from "10 cm". The borde is a fixed 13 cm
      // de alto, so a measurement here is never an order. NOTE: "grueso/delgado" is the
      // VARIANT, not a width — match alto/altura/ancho/grosor, never grueso.
      const asksBordeWidth = /\b(alto|altura|ancho|anchura|grosor|espesor)\b/i.test(msgB) || /qu[eé]\s+tan\s+(ancho|alto)/i.test(msgB);
      // A0) We asked WHICH VERSION for a length they already picked — resolve it the
      // moment they answer, in either vocabulary (Premium/grueso, Flexible/delgado).
      // A multi-presentation order waits here too (the client's flow-1: "¿Los prefieres
      // en versión Premium o Flexible?" → "Premium" → both prices and both links).
      if (state.awaitingBordeOrder && Array.isArray(state.awaitingBordeOrder) && msgVariant) {
        const pairsO = state.awaitingBordeOrder;
        state.awaitingBordeOrder = null;
        const outO = await sendBordeOrder(msgVariant, pairsO);
        if (outO) return outO;
      }
      if (state.awaitingBordeVariant && msgVariant) {
        const rec0 = state.awaitingBordeVariant; state.awaitingBordeVariant = null;
        const by0 = await bordeLeavesByLength(msgVariant);
        const leaf0 = by0.get(String(rec0.length));
        const pi0 = leaf0 ? await resolvePrice(leaf0, altOpt(state, leaf0)).catch(() => null) : null;
        if (pi0 && pi0.amount) {
          state.activeProductId = String(leaf0._id);
          // They had already told us HOW MANY while we were asking which version →
          // close it now instead of asking the quantity we already have.
          if (rec0.qty) {
            return isRetailOrder(rec0.length, rec0.qty)
              ? await shareLink(leaf0, String(rec0.length), rec0.qty)
              : await mayoreo(rec0.qty, String(rec0.length));
          }
          state.awaitingBordeQty = { productId: String(leaf0._id), length: String(rec0.length) };
          return retB(
            `¡Excelente! El borde ${VARIANT_LABEL[msgVariant]} de ${rec0.length} m está en $${pi0.amount}. ¿Cuántos rollos necesitas? 😊`,
            { bordeVariantPicked: msgVariant, bordeAskQty: String(rec0.length) }
          );
        }
      }
      // A0b) They answered the VERSION question with a QUANTITY ("uno", "dos"). The
      // profile needs the version before the threshold can be applied, so remember the
      // count and ask the version once more, with both prices. Left to the model this
      // produced "te comparto el de 54 m en Premium" with no price, and for two rolls
      // an offer to send a purchase link for what the rules call mayoreo.
      if (state.awaitingBordeVariant && !msgVariant) {
        const recQ = state.awaitingBordeVariant;
        // The reader decides whether this reply is a COUNT for the roll we asked about
        // or a RE-SPECIFIED order ("uno de 6 y uno de 18"). Both used to land here as
        // "the first number is the quantity".
        const rV = readMsg({ pendingLength: recQ.length, expectCount: true });
        if (rV.pivotsFrom) state.awaitingBordeVariant = null;
        const qV = rV.pivotsFrom || asksBordeWidth ? null : rV.count;
        if (qV != null && qV >= 1) {
          // The profile is decided by length × quantity and NEVER by the version, so
          // once we have the count there is nothing to wait for: route mayoreo now.
          // Asking "¿Premium o Flexible?" first spent a turn on a question the asesor
          // settles anyway, on exactly the lead the rules want captured fastest.
          if (!isRetailOrder(recQ.length, qV)) {
            state.awaitingBordeVariant = null;
            return await mayoreo(qV, String(recQ.length));
          }
          state.awaitingBordeVariant = { length: recQ.length, qty: qV };
          // We showed both prices for this length on the PREVIOUS turn, so restating
          // the table here just says the same thing twice. Ask only what's missing.
          return retB(
            `¡Perfecto, ${qV} rollo${qV === 1 ? "" : "s"} de ${recQ.length} m! ¿Lo quieres Premium (grueso) o Flexible (delgado)? 😊`,
            { bordeQtyPendingVariant: qV }
          );
        }
      }
      // 0) WIDTH/HEIGHT question. The borde separador is a FIXED 13 cm de alto (× the
      // length you pick) — it is NOT sold by width. The bot used to dodge this and keep
      // pushing the largo (reported: customer asked "cuánto mide de ancho" 3× and never
      // got 13 cm). Answer it FIRST, then continue: if they named a single length, quote
      // that roll; otherwise ask the largo.
      if (asksBordeWidth) {
        const width = "El borde separador mide 13 cm de alto (el largo lo eliges tú).";
        const r0 = rMsg;
        if (!r0.hasWxL && r0.lengths.length === 1) {
          const len = r0.lengths[0];
          const leaf = await findProductInFamilies(msgB, bordeFams, null).catch(() => null);
          const ed = leaf && leaf.enabledDimensions;
          const exactLen = leaf && new RegExp(`\\b${len}\\b`).test(`${leaf.name || ""} ${leaf.size || ""}`);
          if (leaf && exactLen && Array.isArray(ed) && ed.length && !ed.includes("width")) {
            const pi = await resolvePrice(leaf, altOpt(state, leaf)).catch(() => null);
            if (pi && pi.amount) {
              state.activeProductId = String(leaf._id);
              state.awaitingBordeQty = { productId: String(leaf._id), length: len };
              return retB(`${width} El rollo de ${len} m está en $${pi.amount}. ¿Cuántos rollos necesitas? 😊`, { bordeWidthAnswered: true, bordeAskQty: len });
            }
          }
        }
        const menu0 = await bordeMenu();
        if (menu0) {
          state.bordeQuoted = menu0.quoted;
          return retB(`${width}\n${menu0.text}`, { bordeWidthAnswered: true, bordeAllQuoted: menu0.quoted });
        }
        return retB(`${width} ${bordeMenuFallback()}`, { bordeWidthAnswered: true, bordeAskLength: true });
      }
      // A CHEAPER OPTION ASKED FOR, with no length in the message — the ONE trigger
      // that puts the Flexible price on the table. It has to be a gate: left to the
      // model it would reach A2 below and answer a price objection by repeating the
      // same prices ("ya te pasé los precios de los rollos de 6, 9, 18, 54 m"), and
      // the whole point of holding the Flexible back is that it has somewhere to land.
      if (flexAsked && !rMsg.hasWxL && !rMsg.lengths.length && !rMsg.countIsExplicit) {
        const menuF = await bordeMenu();
        if (menuF) {
          state.bordeQuoted = menuF.quoted;
          const leadF = asksCheaper
            ? `Sí, hay una más económica: la versión ${VARIANT_SPEC.delgado}. Te dejo las dos, por rollo:`
            : `Manejamos dos versiones, ${VARIANT_SPEC.grueso} y ${VARIANT_SPEC.delgado}, cada una por rollo:`;
          return retB(`${leadF}\n${menuF.rows.join("\n")}\n¿Cuál te sirve? 😊`, {
            bordeFlexRevealed: asksCheaper ? "cheaper" : "versions",
            bordeAllQuoted: menuF.quoted,
          });
        }
      }
      // A) awaiting quantity from last turn (we asked "¿cuántos?")
      if (state.awaitingBordeQty) {
        const rec = state.awaitingBordeQty; state.awaitingBordeQty = null;
        // A number glued to a length unit ("el de 18 m") is the client PIVOTING to a
        // different roll length, NOT the answer to "¿cuántos rollos?" — reading it as
        // a count sent "el de 18 m" to mayoreo as "18 rollos" (reported, 64c3126), and
        // "3 piezas de 18 m" answered to a 54 m question was routed as 3 rolls of 54.
        // The reader settles both: it reports the count AND whether the reply moved to
        // a different presentation.
        const rA = readMsg({ pendingLength: rec.length, expectCount: true });
        // THEY GAVE A C.P. INSTEAD OF A COUNT. It is never a quantity (five digits), but
        // letting the turn fall through to the model got "Si gustas, te comparto la
        // ubicación" — offering the address instead of sharing it, and the quantity
        // question lost. Bank the C.P., thank them, and ask the count once more.
        if (rA.zipLike && rA.count == null && !asksBordeWidth) {
          const zipA = (msgB.match(/\b(\d{5})\b/) || [])[1];
          if (zipA) {
            state.location = { ...(state.location || {}), zip: zipA, zipcode: zipA };
            state.awaitingBordeQty = rec; // re-arm: the NEXT number is the count
            return retB(
              `¡Gracias! 🙏 Ya registré tu código postal ${zipA}. ¿Cuántos rollos de ${rec.length} m necesitas? 😊`,
              { bordeZipCaptured: zipA, bordeAskQty: rec.length }
            );
          }
        }
        // THEY ANSWERED WITH A VERSION, not a count ("Flexible", "mejor el premium").
        // The length is already decided, so stay on it and re-ask the quantity. Without
        // this the turn fell through to gate C, which re-listed ALL FOUR lengths and
        // lost the roll the customer had just picked — the same "a gate answered half
        // the message" family as the C.P. case above.
        if (msgVariant && rA.count == null && !rA.pivotsFrom && !asksBordeWidth) {
          const byLenV = await bordeLeavesByLength(msgVariant);
          const leafV = byLenV.get(String(rec.length));
          const piV = leafV ? await resolvePrice(leafV, altOpt(state, leafV)).catch(() => null) : null;
          if (piV && piV.amount) {
            state.activeProductId = String(leafV._id);
            state.awaitingBordeQty = { productId: String(leafV._id), length: String(rec.length) };
            return retB(
              `¡Claro! El rollo ${VARIANT_LABEL[msgVariant]} de ${rec.length} m está en $${piV.amount}. ¿Cuántos rollos necesitas? 😊`,
              { bordeVariantPicked: msgVariant, bordeAskQty: String(rec.length) }
            );
          }
        }
        // A COMPARATIVE TAIL about the versions, after they already chose one ("Que el
        // flexible" closing "…está mejor el premium"). detectVariant returns null for
        // it on purpose, so restate the roll they picked — letting it fall through
        // re-listed all four lengths and threw away the 54 m.
        if (!msgVariant && rA.count == null && !rA.pivotsFrom && !asksBordeWidth && !rMsg.numbers.length &&
            variantKnown() && /\b(?:grues\w*|premium|delgad\w*|flexible)\b/i.test(msgB)) {
          const byLenT = await bordeLeavesByLength(variantKnown());
          const leafT = byLenT.get(String(rec.length));
          const piT = leafT ? await resolvePrice(leafT, altOpt(state, leafT)).catch(() => null) : null;
          if (piT && piT.amount) {
            state.activeProductId = String(leafT._id);
            state.awaitingBordeQty = { productId: String(leafT._id), length: String(rec.length) };
            return retB(
              `El rollo ${VARIANT_LABEL[variantKnown()]} de ${rec.length} m está en $${piT.amount}. ¿Cuántos rollos necesitas? 😊`,
              { bordeVariantRestated: variantKnown(), bordeAskQty: String(rec.length) }
            );
          }
        }
        // Nothing in this message touches the quantity or the length (a question
        // riding along, a "ok", a fragment): KEEP the pending roll so the turn can
        // continue to the model or to another gate WITHOUT gate C deciding that no
        // length was ever chosen and re-listing the four of them.
        if (rA.count == null && !rA.pivotsFrom && !rMsg.numbers.length) state.awaitingBordeQty = rec;
        const q = rA.pivotsFrom || asksBordeWidth ? null : rA.count;
        if (q != null && q >= 1) {
          if (!isRetailOrder(rec.length, q)) return await mayoreo(q, rec.length);
          const leaf = await PFm.findById(rec.productId).lean().catch(() => null);
          const out = leaf ? await shareLink(leaf, rec.length, q) : null;
          if (out) return out;
        }
        // else: a length pivot → fall through so section B resolves that roll.
      }
      // THEY DOWNSIZED. A customer we just quoted as mayoreo who answers "mejor solo
      // uno" has moved back to an individual purchase (§3.2 classifies on the quantity
      // the customer expresses), and we still know which presentation we were talking
      // about. Re-decide the profile instead of leaving them parked in a handoff — and
      // never answer their next shipping question with the mayoreo freight line.
      if (state.bordeWholesaleTrack && state.bordeWholesaleLen && !asksBordeWidth) {
        const lenW = String(state.bordeWholesaleLen);
        const rW = readMsg({ pendingLength: lenW, expectCount: true });
        const qW = rW.pivotsFrom ? null : rW.count;
        if (qW != null && qW >= 1 && String(qW) !== String(state.lead && state.lead.wholesaleQty)) {
          if (!isRetailOrder(lenW, qW)) return await mayoreo(qW, lenW);
          const vW = variantKnown();
          const byLenW = await bordeLeavesByLength(vW || VARIANT_FALLBACK);
          const leafW = byLenW.get(lenW);
          if (leafW && (vW || !showFlex())) {
            state.activeProductId = String(leafW._id);
            const outW = await shareLink(leafW, lenW, qW);
            if (outW) return outW;
          }
          const bothW = await bordeBothVersions(lenW);
          if (bothW) {
            state.bordeWholesaleTrack = false;
            state.awaitingBordeVariant = { length: lenW, qty: qW };
            return retB(`¡Claro, ${qW} rollo${qW === 1 ? "" : "s"} de ${lenW} m! ${bothW}`, { bordeDownsized: `${qW}x${lenW}` });
          }
        }
      }
      // A1b) A WHOLE ORDER IN ONE MESSAGE: quantity + presentation ("3 piezas de 18
      // metros premium", "2 rollos de 54", "uno de 6 y uno de 18"). No gate handled this
      // shape — A2 and B each need a SINGLE number — so it reached the model, which sold
      // 3 pieces of 18 m and 2 rolls of 54 m with a purchase link (both are mayoreo under
      // §2.B / §3.2 / §5) and answered "2 piezas de 9 m flexible" with the GRUESO listing
      // at the grueso price. The profile decision belongs here, not in the model.
      const bordeOrderPairs = rMsg.pairs;
      if (bordeOrderPairs.length) {
        const overLine = bordeOrderPairs.find((p) => !isRetailOrder(p.len, p.qty));
        if (overLine) {
          // Any line over the individual threshold makes the whole order an asesor
          // matter. The version never changes that (§3.2 decides on pieces), so route
          // now instead of spending a turn asking Premium or Flexible.
          state.awaitingBordeVariant = null; state.awaitingBordeOrder = null;
          state.awaitingBordeQty = null; state.bordeQuoted = null;
          if (bordeOrderPairs.length === 1) return await mayoreo(overLine.qty, overLine.len);
          state.lead = { ...(state.lead || {}), wholesaleQty: bordeOrderPairs.map((p) => `${p.qty}x${p.len}m`).join(" + ") };
          return beginHandoff({
            preface: `Tu pedido (${bordeOrderPairs.map((p) => `${p.qty} de ${p.len} m`).join(" y ")}) entra en precio de MAYOREO por las ${overLine.qty} piezas de ${overLine.len} m.`,
            reason: `Mayoreo borde${variantKnown() ? ` ${VARIANT_LABEL[variantKnown()]}` : ""} — pedido ${bordeOrderPairs.map((p) => `${p.qty}×${p.len} m`).join(" + ")}`,
            wholesale: true,
          });
        }
        // Individual purchase. The version sets the price, so never guess it: ask once,
        // remembering the order so the answer closes it (the client's flow-1).
        // With the Flexible off the table there is no version to ask about: the
        // grueso IS the quote. It stays null once the customer has asked for a cheaper
        // option, so that case still gets both prices and picks from the numbers.
        const vOrd = variantKnown() || (showFlex() ? null : VARIANT_FALLBACK);
        if (!vOrd) {
          if (bordeOrderPairs.length === 1) {
            const p0 = bordeOrderPairs[0];
            const bothO = await bordeBothVersions(p0.len);
            if (bothO) {
              state.awaitingBordeVariant = { length: p0.len, qty: p0.qty };
              return retB(`¡Claro, ${p0.qty} rollo${p0.qty === 1 ? "" : "s"} de ${p0.len} m! ${bothO}`, { bordeAskVariant: p0.len, bordeQtyPendingVariant: p0.qty });
            }
          } else {
            state.awaitingBordeOrder = bordeOrderPairs;
            return retB(
              `¡Claro! ${bordeOrderPairs.map((p) => `${p.qty} de ${p.len} m`).join(" y ")}. ¿Los prefieres en versión ${VARIANT_SPEC.grueso} o ${VARIANT_SPEC.delgado}? 😊`,
              { bordeAskVariantForOrder: bordeOrderPairs.map((p) => `${p.qty}x${p.len}`) }
            );
          }
        }
        if (vOrd) {
          if (bordeOrderPairs.length === 1) {
            const p0 = bordeOrderPairs[0];
            const byLenO = await bordeLeavesByLength(vOrd);
            const leafO = byLenO.get(String(p0.len));
            if (leafO) {
              state.activeProductId = String(leafO._id);
              const outO = await shareLink(leafO, p0.len, p0.qty);
              if (outO) return outO;
            }
          } else {
            const outO = await sendBordeOrder(vOrd, bordeOrderPairs);
            if (outO) return outO;
          }
        }
      }
      // B) a new SINGLE, EXACT length (no W×L, exactly one length number) → resolve to a
      // LENGTH-ONLY borde product. Skip 2+ lengths (multi-length path quotes each) and
      // non-exact lengths like 57 (the closest-size path handles those).
      const rB = rMsg;
      const hasWxL = rB.hasWxL;
      const allNums = rB.lengths; // catalogue lengths named, in order of appearance
      // A2) We ALREADY quoted borde length(s) and the reply brings NO new length (a CP
      // like "20900", a "sí claro", a "gracias"): NEVER re-ask the largo — that's the
      // recurring bug. A real quantity closes it (2+ = mayoreo); otherwise nudge toward
      // quantity, restating what we already sent — never re-asking which length.
      if (state.bordeQuoted && state.bordeQuoted.length && !hasWxL) {
        // They answered with the VERSION ("Premium") after seeing the menu → send that
        // version's four lengths with prices and links (the client's flow 2).
        if (msgVariant && !allNums.length) {
          const vlA2 = await bordeVersionList(msgVariant);
          if (vlA2) {
            state.bordeQuoted = vlA2.quoted;
            return retB(vlA2.text, { bordeVersionList: msgVariant });
          }
        }
        // A number that IS one of our lengths, with no explicit count, is the customer
        // PICKING from the menu we just sent — not a quantity. Fall through so section B
        // resolves that roll. Without this the menu's own options came back as
        // quantities ("¡Perfecto, 18!") because every length was already quoted.
        const picksLength = !rB.countIsExplicit && allNums.length === 1;
        const hasNewLen = allNums.some((n) => !state.bordeQuoted.includes(n));
        if (!picksLength && !hasNewLen) {
          const q = rB.count;
          // Linear metres need a length. With exactly ONE roll quoted we know it;
          // with several on the table a bare "2" doesn't say 2 of WHICH, so ask
          // instead of guessing a profile that decides retail vs asesor.
          if (q != null && q >= 1 && state.bordeQuoted.length === 1) {
            const only = state.bordeQuoted[0];
            if (!isRetailOrder(only, q)) { state.bordeQuoted = null; return await mayoreo(q, only); }
          }
          if (q != null && q >= 1 && state.bordeQuoted.length > 1) {
            return retB(`¡Perfecto, ${q}! ¿De cuál largo los quieres: ${state.bordeQuoted.map((l) => l + " m").join(", ")}? 😊`, { bordeNeedLengthForQty: q });
          }
          return retB(`¡Gracias! Ya te pasé los precios de los rollos de ${state.bordeQuoted.map((l) => l + " m").join(", ")}. ¿Cuál te sirve y cuántos necesitas? 😊`, { bordeQuotedNudge: state.bordeQuoted });
        }
        state.bordeQuoted = null; // a genuinely NEW length → fall through to resolve it
      }
      if (!hasWxL && allNums.length === 1 && !state.awaitingBordeQty) {
        const len = allNums[0];
        const vB = variantKnown();
        if (!vB) {
          // Length picked, version still unknown. Two options, so ASK — a closed
          // choice between the two we sell, never an open question and never a
          // silent default that would quote Premium prices to a Flexible buyer.
          const both = await bordeBothVersions(len);
          if (both) {
            state.awaitingBordeVariant = { length: len };
            return retB(`¡Claro! ${both}`, { bordeAskVariant: len, bordeBothPriced: true });
          }
        }
        // Resolve by thickness, not by text match: both versions carry the same length
        // names, so a text score returns whichever it likes and mixes the price lists.
        const byLenB = await bordeLeavesByLength(vB || VARIANT_FALLBACK);
        const leaf = byLenB.get(len);
        const pi = leaf ? await resolvePrice(leaf, altOpt(state, leaf)).catch(() => null) : null;
        if (leaf && pi && pi.amount) {
          state.activeProductId = String(leaf._id);
          // EXPLICIT count only — the bare number here IS the length they just picked.
          const q = rB.countIsExplicit ? rB.count : null;
          if (q != null && q >= 1) {
            return isRetailOrder(len, q) ? await shareLink(leaf, len, q) : await mayoreo(q, len);
          }
          // No quantity yet. A single roll of this length may ALREADY be a full roll,
          // so ask the quantity rather than implying a self-serve sale.
          const vLabB = vB ? ` ${VARIANT_LABEL[vB]}` : "";
          state.awaitingBordeQty = { productId: String(leaf._id), length: len };
          return retB(`¡Claro! El rollo${vLabB} de ${len} m está en $${pi.amount}. ¿Cuántos rollos necesitas? 😊`, { bordeAskQty: len });
        }
      }
      // B1) NEAREST LENGTH. A single length we DON'T carry ("el de 50 m") must get the
      // closest one we DO carry (54 m) with its price + link — never a bare "no lo
      // tengo", never a smaller default, never an escalation (reported: it denied 50 m
      // and pushed the 18 m instead of offering the 54 m). The malla flow already
      // resolves nearest measures deterministically; borde didn't, so the model
      // improvised — a knowledge rule alone held in only 1 of 3 runs.
      // Requires an explicit length unit so a bare quantity reply ("2") can never be
      // read as a length.
      // NOTE: this path reads rMsg.numbers, not allNums (= the CATALOGUE lengths). The
      // whole point here is a length we do NOT carry — "quiero 20 metros" — so filtering
      // to the catalogue first makes this gate unreachable and the menu answers instead
      // of naming the nearest presentation.
      const isLengthAsk = /\b\d{1,3}\s*(?:m\b|mts?\b|metros?\b)/i.test(msgB);
      if (!hasWxL && isLengthAsk && rMsg.numbers.length === 1 && !state.awaitingBordeQty) {
        const want = parseInt(rMsg.numbers[0], 10);
        if (Number.isFinite(want) && !BORDE_LENS.includes(String(want))) {
          // Nearest by absolute difference; on a tie prefer the LARGER (it covers the need).
          const nearest = BORDE_LENS.map(Number).sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || b - a)[0];
          // Version unknown? Name the nearest presentation and ask which of the two,
          // exactly as the client's flow-1 example does — a price here would be a
          // silent bet on one version.
          if (!variantKnown()) {
            const bothN = await bordeBothVersions(String(nearest));
            if (bothN) {
              state.awaitingBordeVariant = { length: String(nearest) };
              return retB(
                `El de ${want} m no lo manejamos; la presentación más cercana es la de ${nearest} m. ${bothN}`,
                { bordeNearestLength: `${want}→${nearest}`, bordeAskVariant: String(nearest), bordeBothPriced: true }
              );
            }
          }
          const byLenB1 = await bordeLeavesByLength(variantKnown() || VARIANT_FALLBACK);
          const leaf = byLenB1.get(String(nearest));
          if (leaf) {
            const pi = await resolvePrice(leaf, altOpt(state, leaf));
            if (pi && pi.amount) {
              const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: leaf.name, productId: String(leaf._id) });
              state.activeProductId = String(leaf._id);
              state.awaitingBordeQty = { productId: String(leaf._id), length: String(nearest) };
              return retB(
                `El de ${want} m no lo manejamos; el más cercano es el rollo de ${nearest} m, en $${pi.amount}.` +
                  (link ? ` Aquí lo compras, con envío gratis: ${link}` : "") +
                  ` ¿Cuántos rollos necesitas? 😊`,
                { bordeNearestLength: `${want}→${nearest}` }
              );
            }
          }
        }
      }

      // B2) TWO+ exact borde lengths at once ("18 y 54 metros") → quote EACH here and
      // REMEMBER them (state.bordeQuoted), so the next turn (a CP, a "sí") is handled by
      // A2 above instead of the model re-asking the largo. Was NOT handled deterministically
      // before — the model quoted them then lost track (the reported recurring bug).
      if (!hasWxL && allNums.length >= 2 && !state.awaitingBordeQty && !state.bordeQuoted) {
        const variant = variantKnown() || VARIANT_FALLBACK;
        const byLenB2 = await bordeLeavesByLength(variant);
        const rows = []; const quoted = [];
        for (const len of allNums) {
          const leaf = byLenB2.get(String(len));
          if (!leaf) continue;
          const pi = await resolvePrice(leaf, altOpt(state, leaf)).catch(() => null);
          if (pi && pi.amount) {
            const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: leaf.name, productId: String(leaf._id) });
            rows.push(`• ${len} m: $${pi.amount}${link ? ` → ${link}` : ""}`);
            quoted.push(String(len));
          }
        }
        if (quoted.length >= 2) {
          state.bordeQuoted = quoted;
          const verB2 = showFlex() ? ` en versión ${VARIANT_LABEL[variant]}` : "";
          return retB(`¡Claro! Te comparto las opciones${verB2}:\n${rows.join("\n")}\nTodos con envío gratis. ¿Cuántos rollos necesitas? 😊`, { bordeMultiQuoted: quoted });
        }
      }
      // C) borde price/product inquiry with NO length yet → deterministically ASK the
      // length (6/9/18/54 m) instead of letting the model escalate to an asesor. The
      // model, under some setups (wholesale/manual), hands off on a bare "precio del
      // borde"; the human rule is: ask the length first, always.
      if (!hasWxL && allNums.length === 0 && !state.awaitingBordeQty && !state.bordeQuoted) {
        // A pure greeting / "Información" opener. The client's flow 2 answers it by
        // naming the two versions and asking which — a closed choice, and the fastest
        // route to a priced list. Without this the turn reached the model, which asked
        // the open "¿qué largo necesitas?" we are removing.
        //
        // THE AD'S OWN CTA MESSAGE IS THAT OPENER (2026-10-28, two asesora reports).
        // Meta prefills the click-to-WhatsApp message, and on this campaign it arrives
        // as "¡Hola! Quiero más información" / "Quiero obtener más información." — 37
        // of them in the last 30 days, and NEITHER matched: the old test required the
        // WHOLE message to be one of a handful of bare tokens, so a bare "Información"
        // got the four priced lengths while the ad's own wording fell through to the
        // model — which has no price in context on this flow (the ad preloads the
        // FAMILY, not a leaf, so priceInfo is null and preloadedAmounts is empty) and
        // answered with a price-less list of largos. Reported as "no dio los precios"
        // and "no le termina de dar precio". Same shape as the Ground Cover opener
        // above: short, no digits, an info/greeting trigger, nothing else asked.
        const tB = msgB.trim();
        const isInfoOpener =
          tB.length <= 70 &&
          !/\d/.test(tB) &&
          /\b(hola|holi|buen[oa]s?|qu[eé]\s+tal|info|informaci[oó]n|informes|me\s+interesa|interesad[oa]|cotizaci[oó]n|cotizar)\b/i.test(tB) &&
          // Anything else named in the opening message is the turn's real question and
          // belongs to the gates/model below — the opener must not talk over it.
          !/\b(medidas?|tama[nñ]os?|largos?|anchos?|alto|altura|grosor|espesor|env[ií]o|entrega|tarda|llega|pago|pagar|tarjeta|factur|garant|instalaci|ubicaci|direcci|d[oó]nde|sucursal|color|negro|verde|material|mayoreo|distribuid\w+|revend\w+)\b/i.test(tB);
        if (isInfoOpener && !variantKnown()) {
          // With only one version on offer there is no choice to ask about, so the
          // opener gets the PRICES — the client's "comparte precios desde el primer
          // intercambio" — instead of a question.
          if (!showFlex()) {
            const menuI = await bordeMenu();
            if (menuI) {
              state.bordeQuoted = menuI.quoted;
              return retB(`¡Hola! Con gusto 😊 ${menuI.text.replace(/^¡Claro! /, "")}`, { bordeInfoOpener: true, bordeAllQuoted: menuI.quoted });
            }
            return retB(`¡Hola! Con gusto 😊 ${bordeMenuFallback()}`, { bordeInfoOpener: true });
          }
          return retB(
            `¡Hola! Con gusto 😊 Manejamos el borde separador en dos versiones: ${VARIANT_SPEC.grueso} y ${VARIANT_SPEC.delgado}, ` +
              `cada una en rollos de 6, 9, 18 y 54 m. ¿Cuál versión te interesa?`,
            { bordeInfoOpener: true }
          );
        }
        const wantsBorde = /(precio|cuánto|cuanto|cotiz|cost|vale|borde|separador|rollo|metr|largo|premium|flexible|grues|delgad)/i.test(msgB);
        // Only ask the length when the message asks NOTHING ELSE. Words like "cuánto"
        // appear in plenty of other questions ("cuánto mide de ancho", "cuánto tarda
        // en llegar", "cómo es el pago"), and intercepting those replaced the answer
        // with "¿qué largo necesitas?" — the customer's actual question never reached
        // the model. When something else is asked we contribute the borde facts and
        // let the turn continue, so the reply covers both.
        const asksSomethingElse =
          /alto|altura|ancho|anchura|grosor|espesor|sobresale|entierra|env[ií]|entrega|tarda|llega|paga|pago|tarjeta|factur|garant|instalaci|color|negro|verde|material|dura|ubicaci|sucursal|mayoreo/i.test(msgB);
        if (wantsBorde && !asksSomethingElse) {
          // BROAD PRICE ASK → QUOTE THE WHOLE LIST. There are only four lengths, so
          // "costos" / "¿a cómo está el metro?" deserves all of them with live prices
          // and links — not another question (reported: the customer asked for costs
          // and got "¿qué largo necesitas?"). Borde only: the other flows have far too
          // many sizes to list. Variant defaults to grueso, same rule as B2. If no
          // price resolves we fall back to asking the largo — never invent one.
          // Resolve the four leaves by WALKING THE TREE, not by text match: the two
          // variants share every length name ("Rollo de 18 m" exists under both
          // Grueso and Delgado), so findProductInFamilies returns whichever it scores
          // higher and the list comes out mixing both price lists. thickness is the
          // real discriminator (3 mm = grueso, 1.5 mm = delgado).
          // They already named the version → that version's four lengths with prices
          // and links. Otherwise the full menu: four lengths × two versions, priced.
          const vC = variantKnown();
          if (vC) {
            const vlC = await bordeVersionList(vC);
            if (vlC) {
              state.bordeQuoted = vlC.quoted;
              return retB(vlC.text, { bordeVersionList: vC });
            }
          }
          const menuC = await bordeMenu();
          if (menuC) {
            state.bordeQuoted = menuC.quoted;
            return retB(menuC.text, { bordeAllQuoted: menuC.quoted });
          }
          return retB(`¡Claro! ${bordeMenuFallback()}`, { bordeAskLength: true });
        }
        if (wantsBorde && asksSomethingElse) {
          earlyFacts.push(
            `- BORDE SEPARADOR: se maneja en rollos de 6, 9, 18 y 54 m (el alto es fijo: 13 cm). ` +
              `Cotiza la versión ${VARIANT_SPEC.grueso}` +
              (showFlex() ? ` y, como el cliente ya pidió algo más económico, puedes dar también la ${VARIANT_SPEC.delgado}.` : ` y NO menciones la versión delgada/Flexible.`) +
              ` Responde PRIMERO lo que el cliente preguntó y, si todavía no sabes qué largo quiere, OFRÉCELE las cuatro medidas con su precio en el mismo mensaje — nunca preguntes "¿qué largo necesitas?" a secas. ` +
              `NO lo pases con un asesor por una pregunta que puedes contestar.`
          );
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
      const { resolvePrice, trackedLink, fmtMoney } = require("./priceResolver");
      const PF = require("../../models/ProductFamily");
      const refFams = require("../../models/Workflow").familyListOf(workflow) || [];
      const msg = String(userMessage);
      // (Explicit "mayoreo" intent is handled earlier by the flow-agnostic gate §1.065,
      // which collects name+phone. Here we only handle the QUANTITY-threshold mayoreo.)
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
          const pi = await resolvePrice(leaf, altOpt(state, leaf)).catch(() => null);
          if (wmq && qty >= wmq) {
            const unit = pi && pi.amount ? ` (cada una $${pi.amount})` : "";
            state.lead = { ...(state.lead || {}), wholesaleQty: String(qty) };
            return beginHandoff({
              preface: `¡Claro! ${qty} piezas de ${dimTxt(dims) || `${dims[0]}x${dims[1]} m`}${unit} entran en precio de MAYOREO 🙌; te preparo una cotización por volumen.`,
              reason: `Mayoreo confeccionada: ${qty} piezas de ${dims[0]}x${dims[1]} (umbral mayoreo ${wmq})`,
              wholesale: true,
            });
          }
          // qty < threshold → retail: make the UNIT price clear + tell them to just set
          // the quantity at checkout (don't multiply, don't leave it ambiguous).
          if (pi && pi.amount) {
            const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: leaf.name, productId: String(leaf._id) });
            state.activeProductId = String(leaf._id);
            const colorTxt = String(leaf.name || "").replace(/^\s*color\s+/i, "").trim();
            const haveZip = !!(state.location && (state.location.zip || state.location.zipcode));
            const rr = `Claro, la ${dims[0]}x${dims[1]}${colorTxt ? " en " + colorTxt : ""} cuesta ${fmtMoney(pi)} cada una (es precio por pieza). Para ${qty}, al comprar solo cambia la cantidad a ${qty} en el mismo enlace: ${link}`;
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
    // Fire ONLY on a bland acknowledgement. This used to be a BLOCKLIST of topic
    // words, which meant any topic it hadn't anticipated got swallowed: "Grado de
    // protección que ofrece y tiempo de garantía" was answered with "¿a qué código
    // postal te llegaría el pedido?" and the customer's two questions were never
    // answered (reported). An allowlist can only ever drop the CP ask, never a question.
    const ackTxt = String(userMessage).trim();
    const isBlandAck =
      ackTxt.length <= 45 &&
      !/[?¿]/.test(ackTxt) &&
      !/\b(que|qu[eé]|cual|cu[aá]l|cuanto|cu[aá]nto|como|c[oó]mo|donde|d[oó]nde|cuando|cu[aá]ndo|quien|qui[eé]n|porque|por\s*qu[eé]|sirve|tiene[n]?|manejan|hay|puedo|puede[n]?|grado|garant\w*|protecci\w*|dura\w*|env[ií]\w*|entrega|paga\w*|pago|factur\w*|color\w*|medida|precio|metro\w*|rollo|ubicaci\w*|direcci\w*|telefono|tel[eé]fono|num\w*|cotiz\w*|descuento|mayoreo|disponib\w*|stock)\b/i.test(ackTxt) &&
      !require("./tools").dimsOf(ackTxt);
    state.pendingZipAsk = false; // one-shot regardless
    if (!haveZip && !msgHasZip && isBlandAck) {
      const reply = "¡Con gusto! ¿A qué código postal te llegaría el pedido? 📍";
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

  // 1.0855 REFORZADA UNAVAILABLE COLOR — confeccionada reforzada is beige / negro /
  // verde. If the customer names a color we DON'T carry (gris, azul, rojo…), say so and
  // offer the real colors — NEVER silently substitute beige (reported: "6x6 color gris"
  // got answered with a beige quote, ignoring gris).
  if (userMessage && /con Refuerzo.*Retail/i.test(workflow.name || "")) {
    try {
      const msgU = String(userMessage).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      const named = [...new Set((msgU.match(/\b(gris|azul|rojo|roja|morad[oa]|turquesa|celeste|dorad[oa]|platead[oa]|terracota|marr[o]n|caf[e])\b/g) || []))];
      if (named.length) {
        const { dimsOf } = require("./tools");
        const d = dimsOf(msgU);
        const nice = named.map((c) => c.replace(/roja$/, "rojo").replace(/morada$/, "morado").replace(/dorada$/, "dorado").replace(/plateada$/, "plateado")).join(" ni ");
        const reply = `En ${nice} no la manejamos 🙏. La malla sombra confeccionada${d ? ` de ${d[0]}x${d[1]}` : ""} la tenemos en beige, negro y verde. ¿Cuál de esos te acomoda?`;
        history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
        return {
          reply,
          state: { ...state, history, nodeId: currentNode.id },
          diagnostics: {
            workflow: { id: String(workflow._id), name: workflow.name },
            fromNode: { id: currentNode.id, name: currentNode.name },
            toNode: { id: currentNode.id, name: currentNode.name },
            unavailableColor: named,
          },
        };
      }
    } catch (err) {
      console.error("⚠️ reforzada unavailable-color handler failed:", err.message);
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
  // 1.0865 LOCATION / SHIPPING COVERAGE. Reported twice: the bot kept OFFERING the
  // address ("si gustas te comparto la ubicación exacta") instead of sharing it, and
  // it escalated "¿Dónde están ubicados? ¿Hacen envíos?" to an asesor — two questions
  // whose answers sit in CompanyInfo. Share them; never offer, never escalate.
  if (userMessage) {
    try {
      const msgL = String(userMessage).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (asksLocationOrShipping(userMessage)) {
        const parts = await locationBlock();
        if (parts && parts.length) {
          // Only OWN the turn when location/shipping is all they asked. Anything else
          // in the message and we contribute the facts and let the turn answer both.
          const restL = msgL
            .replace(/\b(donde|estan|se|ubican|encuentran|ubicaci\w*|ubicados?|direccion|domicilio|sucursal|planta|maps|mapa|como|llego|hacen?|env[ií]?o?s?|envian|mandan|llegan?|entregan|cobertura|a|toda|todo|la|lo|los|las|le|me|mi|nos|republica|el|pais|en|que|estado|ciudad|de|son|y|o|hola|buenas?|buenos?|dias|tardes|gracias|por|favor)\b/g, " ")
            .replace(/[^a-z0-9]/g, "")
            .trim();
          if (!restL) {
            const reply = parts.join("\n");
            history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
            return {
              reply,
              state: { ...state, history, nodeId: currentNode.id },
              diagnostics: {
                workflow: { id: String(workflow._id), name: workflow.name },
                fromNode: { id: currentNode.id, name: currentNode.name },
                toNode: { id: currentNode.id, name: currentNode.name },
                locationAnswered: true,
              },
            };
          }
          earlyFacts.push(
            `- UBICACIÓN Y ENVÍOS (compártelos TAL CUAL en este mismo mensaje, nunca los ofrezcas "si gustas" ni pases con un asesor por esto):\n  ${parts.join("\n  ")}`
          );
        }
      }
    } catch (err) {
      console.error("⚠️ location gate failed:", err.message);
    }
  }

  // contact (reported bug: "No compartió nuestros números antes del handoff").
  if (userMessage) {
    try {
      const msgP = String(userMessage).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      // Are they GIVING their own number (not asking for ours)? Skip if so.
      const givingOwn = /\bmi\b[^]*\b(numero|telefono|tel|whats?app?|whats|wasap|wpp)\b/.test(msgP) || /\d{10}/.test(msgP.replace(/\D/g, ""));
      const hasPhoneWord = /\btelefono\b|\btel\b|\bwhat?sapp?\b|\bwhats\b|\bwasap\b|\bwpp\b|\blada\b/.test(msgP);
      const numeroReq = /\bnum(ero)?\b/.test(msgP) && /\balgun|\bun\b|\buno\b|\bsu\b|\btu\b|\bel\b|\botro\b|\bdame\b|\bdas\b|\bpasa|\btiene|\bhay\b|\bcual\b|\ba que\b|\bpara\b|\bcontacto\b|\bmarcar\b|\bllamar\b|\bhablar\b|\bcomunicar|\bme das\b|\bfacilit/.test(msgP);
      const isPhoneRequest = !givingOwn && (hasPhoneWord || numeroReq);
      if (isPhoneRequest) {
        const { getBusinessInfo } = require("../../businessInfoManager");
        const biz = await getBusinessInfo().catch(() => null);
        const fmtPhone = (p) => {
          const d = String(p || "").replace(/\D/g, "").slice(-10);
          return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : String(p || "").trim();
        };
        // Use the labels CompanyInfo actually stores. This used to take the first
        // two numbers and label them BY POSITION ("Teléfono de tienda", "WhatsApp"),
        // which is how the bot handed out 442 191 9091 as WhatsApp while the
        // asesores hand out 442 595 7432 — the third entry, never reached by a
        // slice(0, 2). When a label repeats, the LAST one wins: numbers are appended
        // as they change, so the newest entry for a label is the live one.
        const labelled = (biz && Array.isArray(biz.phonesLabelled) ? biz.phonesLabelled : [])
          .filter((p) => p && p.number);
        const byLabel = new Map();
        for (const p of labelled) byLabel.set((p.label || "Teléfono").toLowerCase(), p);
        const entries = [...byLabel.values()];
        const phones = entries.length
          ? entries
          : (biz && Array.isArray(biz.phones) ? biz.phones : []).filter(Boolean).slice(0, 2).map((n) => ({ label: "Teléfono", number: n }));
        if (phones.length) {
          const lines = phones.map((p) => `${p.label || "Teléfono"}: ${fmtPhone(p.number)}`).join("\n");
          const waLink = (biz && biz.whatsappLink) || "";
          const reply =
            `¡Claro! Estos son nuestros datos de contacto:\n${lines}` +
            (waLink ? `\n${waLink}` : "") +
            `\n\nCon gusto te atendemos por cualquiera de ${phones.length > 1 ? "ellos" : "estos medios"}. 😊`;
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
  // Ground cover is NOT excluded here: it really does come in negro and blanco,
  // each its own sellable leaf with its own price and link. It used to be lumped in
  // with the colourless rollo flow, so a "¿de qué color?" fell through to the model,
  // which denied the colours outright and escalated on one we don't carry.
  if (userMessage && colorAnchorId && !/sin\s*refuerzo/i.test(workflow.name || "") && !/\brollo\b/i.test(workflow.name || "")) {
    try {
      const msgC = String(userMessage).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      // "la oscura" / "la clarita" name a color by shade, not by name — and the bot used
      // to miss them entirely: "el metro de la oscura" was answered with a BEIGE quote
      // (reported, psid 29182652441424827). We can't know whether "oscura" means negro or
      // verde, so we route it here: this gate LISTS the real colors with their own prices
      // and links, which is the honest answer. It must never silently become beige.
      const COLORW = /\b(beige|negro|negra|verde|blanc[oa]|gris|azul|rojo|caf[e]|marr[o]n|terracota|vino|oscur[oa]s?|clar[oa]s?|clarit[oa]s?)\b/;
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
        const { resolvePrice, trackedLink, fmtMoney } = require("./priceResolver");
        const anchor = await PF.findById(colorAnchorId).lean().catch(() => null);
        const variants = anchor ? await availableVariantsForProduct(anchor).catch(() => []) : [];
        if (variants.length > 1) {
          const lineByColor = new Map(); // "beige" → "• Beige: $X → link"
          const colorMeta = new Map();   // "beige" → { id, amount, link, plusIva }
          const noLinkColors = new Set(); // colours we can quote but NOT sell self-serve
          for (const v of variants) {
            const leaf = await PF.findById(v.id).lean().catch(() => null);
            const pi = leaf ? await resolvePrice(leaf, altOpt(state, leaf)).catch(() => null) : null;
            if (pi && Number.isFinite(pi.amount) && pi.amount > 0 && !pi.soldOut) {
              // GUARD: never hand out a link whose listing is for a DIFFERENT colour.
              // Color Negro 6x4 carries the beige listing's URL, so a customer asking
              // for negro was sent to buy beige (reported). Trust the leaf's own colour
              // over the link, and drop the link rather than send the wrong product.
              const normC = (c) => String(c || "").toLowerCase().replace("negra", "negro").replace("blanca", "blanco");
              const slugC = (String(pi.link || "").match(/\b(beige|negro|negra|verde|blanco|blanca|gris)\b/i) || [])[1];
              const leafC = (String(v.label || "").match(/\b(beige|negro|negra|verde|blanco|blanca|gris)\b/i) || [])[1];
              const wrongColorLink = !!(slugC && leafC && normC(slugC) !== normC(leafC));
              if (wrongColorLink) {
                console.warn(`⚠️ [colorOffer] ${v.label} link points at a ${slugC} listing — dropping it: ${pi.link}`);
                noLinkColors.add(String(v.label).toLowerCase());
              }
              const link = wrongColorLink ? null : await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: `${anchor.size || ""} ${v.label}`.trim(), productId: v.id });
              if (!link) noLinkColors.add(String(v.label).toLowerCase());
              // If THIS color also carries a live discount, mention it (rebajado de $X).
              const disc = pi.hasDiscount && Number.isFinite(pi.originalPrice) && pi.originalPrice > pi.amount ? `, rebajado de $${Math.round(pi.originalPrice)}` : "";
              lineByColor.set(String(v.label).toLowerCase(), `• ${v.label}: ${fmtMoney(pi)}${disc}${link ? ` → ${link}` : ""}`);
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
                    state.lead = { ...(state.lead || {}), wholesaleQty: String(qtyC) };
                    return beginHandoff({
                      preface: `¡Claro! ${qtyC} piezas de ${size} en ${cap(_c1)} (cada una $${_meta.amount}) entran en precio de MAYOREO 🙌; te preparo una cotización por volumen.`,
                      reason: `Mayoreo confeccionada: ${qtyC} piezas ${size} ${_c1}`,
                      wholesale: true,
                    });
                  }
                  reply = `${preU}la ${size} en ${cap(_c1)} cuesta ${fmtMoney(_meta)} cada una (es precio por pieza). Para ${qtyC}, al comprar solo cambia la cantidad a ${qtyC} en el mismo enlace: ${_meta.link}`;
                  definitiveLink = true;
                } else if (noLinkColors.has(_c1) && _meta) {
                  // Quoted but not buyable online (dead or mismatched listing, e.g.
                  // Verde 6x4 whose listing 404s) → quote, then an asesor. Dangling a
                  // bare price with no link left the customer with nowhere to go.
                  return beginHandoff({
                    preface: `Sí, la ${size} en ${cap(_c1)} está en $${_meta.amount}, pero ahora mismo no la tenemos publicada para compra en línea.`,
                    reason: `${size} ${_c1} sin publicación activa en Mercado Libre — cotizada en $${_meta.amount}; cerrar la venta con un asesor`,
                  });
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
            // These branches read "…, la 6x4 la tenemos en:" after a prefix; with no
            // prefix the message went out starting in lowercase (reported in a live
            // reply: "la 6x4m la tenemos en:").
            reply = reply.replace(/^([a-záéíóúñ])/, (c) => c.toUpperCase());
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
  // THE MEASURE THE CUSTOMER NAMED THIS TURN — resolved ONCE, here, because several
  // gates need it. The AI extractor is the only thing that catches prose phrasings
  // ("4 m. De largo por 3.60 m de ancho"); dimsOf/extractAllMeasures are the digit
  // fallbacks. It used to be computed far below the promo gate, so the promo hijacked
  // a turn whose measure only the AI could see (reported: that exact question was
  // answered with the 6x4 promo at $699, his measure ignored entirely).
  let turnWantDims = null;
  if (userMessage) {
    try {
      const { extractMeasure } = require("../utils/measureExtractor");
      const { dimsOf } = require("./tools");
      turnWantDims =
        (await extractMeasure(String(userMessage))) ||
        dimsOf(String(userMessage)) ||
        extractAllMeasures(String(userMessage))[0] ||
        null;
    } catch (e) {
      console.error("⚠️ measure extraction failed:", e.message);
    }
  }
  // ALREADY QUOTED THE PROMO. Tell the model so it stops asking for a measure it
  // has already been given (reported: it re-asked right after the zip reply).
  if (state.promoQuoted && state.promoQuoted.amount && !turnWantDims) {
    const q = state.promoQuoted;
    earlyFacts.push(
      `- YA COTIZASTE EN ESTA CONVERSACIÓN: ${q.label || "el producto en promoción"}${q.size ? ` (medida ${q.size})` : ""} en $${q.amount}. ` +
        `PROHIBIDO volver a pedir la medida o el producto: ya los sabes. Si el cliente confirma interés, cierra con el precio y el link.`
    );
  }
  // NAMED A MEASURE ⇒ NOT a promo request: he asked about THAT size.
  const namesAMeasure = !!turnWantDims;
  if (userMessage && !state.purchased && !rainIntent && !namesAMeasure && (state.promoPitch || state.promoQuote) && (!state.promoPitchSent || state.promoDismissed)) {
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
          // REMEMBER what we just quoted. Without this the NEXT turn had no measure
          // in context: a customer who answered the zip ask was then asked for the
          // measure the bot had quoted two turns earlier, and had to repeat it.
          const quotedPromo = state.promoQuote && state.promoQuote.amount
            ? { label: state.promoQuote.label || null, amount: state.promoQuote.amount, size: state.promoQuote.size || null }
            : state.promoQuoted || null;
          return {
            reply,
            state: { ...state, history, promoPitchSent: true, promoDismissed: false, activeProductId: promoProductId, promoQuoted: quotedPromo, nodeId: currentNode.id },
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
    // NO measure named this turn. Must use the turn's AI-resolved measure, not just the
    // digit matcher: "4 m. De largo por 3.60 m de ancho" is invisible to
    // extractAllMeasures, so this gate quoted the preloaded PROMO (6x4, $699) and
    // ignored the size he actually asked for (reported).
    !turnWantDims
  ) {
    try {
      const PF = require("../../models/ProductFamily");
      const { resolvePrice, trackedLink, fmtMoney } = require("./priceResolver");
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
          const pi = await resolvePrice(doc, altOpt(state, doc));
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
                preface: `¡Claro! La malla de ${nm} tiene un precio de ${fmtMoney({ amount, plusIva })}.`,
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
          `¡Claro! ${name}${isPromo ? " está en promoción por" : " tiene un precio de"} ${fmtMoney({ amount, plusIva })}.` +
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
  // NO-ACTIVE-FLOW PRODUCT → HUMAN. Malla MONOFILAMENTO is a distinct product from the
  // Raschel we sell and has no active flow. It must hand off to a human — NEVER be
  // substituted with Raschel. This runs BEFORE the measure router, which would otherwise
  // route a roll measure (4.2x100) straight into the Raschel Rollo flow (reported bug).
  // Skip pure comparison questions ("¿diferencia entre raschel y monofilamento?").
  if (userMessage && /\bmonofilament/i.test(userMessage) &&
      !/diferencia|versus|\bvs\b|comparar|comparaci[oó]n|cu[aá]l es mejor/i.test(userMessage)) {
    return beginHandoff({
      preface: `¡Claro! La malla de monofilamento te la cotiza mejor uno de nuestros asesores; te paso con uno para ayudarte. 🙌`,
      reason: `Malla monofilamento (sin flujo activo) — requiere asesor`,
    });
  }
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
  // …EXCEPT when the roll gate has just established that this measure is no roll of
  // ours (3x4 m on the Ground Cover ad). Skipping the router there left the turn to
  // the "closest measure" gate, which offered a 4 x 10 m ANTIMALEZA roll for a 3 x 4 m
  // shade-cloth panel, and to the scope classifier, whose verdict is a model call and
  // came back "current" about half the time. routeByMeasure is deterministic: GC owns
  // no 3x4 leaf, so case (c) sends it to the flow that does.
  if (userMessage && !inSinRefuerzo && (!isRollFlow || rollFlowRejectedMeasure) && (opts._switchDepth || 0) < 2 && !opts.sandboxNoAutoSwitch) {
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
      let det = await detectFlowSwitch(String(userMessage), familyList, workflow);
      // SIN-REFUERZO never SWITCHES to REFORZADA — they're the SAME product (con/sin
      // refuerzo variants). A size sin-refuerzo doesn't carry must be handled by the
      // sin→reforzada MENTION gate further down (quote reforzada + link, NO switch, no
      // handoff). The scope classifier tends to route "confeccionada con argollas 7x10"
      // to the reforzada flow; dropping that switch lets the mention gate run instead.
      if (det && det.toName && /sin\s*refuerzo/i.test(workflow.name || "") &&
          /con\s*refuerzo/i.test(det.toName) && !/sin\s*refuerzo/i.test(det.toName)) {
        det = null;
      }
      if (det && det.needsHuman) {
        // Product we make but no active flow serves it (e.g. monofilamento) → hand off
        // to a human. NEVER substitute a lookalike active product (Raschel) as if it
        // were what they asked for.
        return beginHandoff({
          preface: `¡Claro! Ese producto te lo cotiza mejor uno de nuestros asesores; te paso con uno para ayudarte. 🙌`,
          reason: det.reason || `Producto sin flujo activo — requiere asesor`,
        });
      }
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
    if (knownZip) {
      // A returning customer may ship somewhere else this time — don't assume the
      // zip on file is the destination. Confirm which CP for THIS order.
      turnContextExtra +=
        `\n- CP YA REGISTRADO (${knownZip}): es de una conversación previa y el cliente podría enviar a OTRA dirección esta vez. NO lo asumas como destino de este pedido. ` +
        `Al concretar la compra/envío, confirma de forma natural a qué código postal le llegaría el pedido ESTA VEZ (el mismo ${knownZip} u otro).`;
    } else if (knownCity) {
      turnContextExtra +=
        `\n- CIUDAD YA CAPTURADA (${knownCity}): úsala de contexto; al concretar el envío confirma a qué código postal le llegaría el pedido esta vez.`;
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
  let directQuote = null; // a fully-resolved quote the engine returns itself (see below)
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
      const wantDims = turnWantDims; // resolved once per turn, above the promo gate

      // WHAT WE HAVE ALREADY QUOTED, so a later "¿por qué es más cara?" is answered
      // with the REAL numbers instead of a rule of thumb. priceTxt is the exact
      // string the customer was shown, so the explanation can never disagree with
      // the quote it is explaining. Keyed by the measure with its sides SORTED (a
      // 6x4 and a 4x6 are the same product), newest last, four deep.
      const cmpTag = (w, l) => [Number(w), Number(l)].sort((a, b) => a - b).join("x");
      const noteQuoted = (d, pi) => {
        if (!Array.isArray(d) || d.length < 2 || !pi || !Number.isFinite(pi.amount)) return;
        const { fmtMoney } = require("./priceResolver");
        const tag = cmpTag(d[0], d[1]);
        const entry = {
          tag, w: Number(d[0]), l: Number(d[1]),
          area: Math.round(Number(d[0]) * Number(d[1]) * 100) / 100,
          amount: pi.amount,
          orig: pi.hasDiscount && Number.isFinite(pi.originalPrice) && pi.originalPrice > pi.amount
            ? Math.round(pi.originalPrice) : null,
          priceTxt: fmtMoney(pi),
        };
        state.lastQuotes = [...(state.lastQuotes || []).filter((q) => q.tag !== tag), entry].slice(-4);
      };

      // ── MULTI-MEASURE ─────────────────────────────────────────────────────
      // If the message names 2+ measures ("6x6m y otra de 6x8m"), quote EACH with
      // its OWN price + link — never collapse to one. Each resolved price is added
      // to the clamp's allow-set so the multi-line quote survives.
      let multiHandled = false;
      const allMeasures = extractAllMeasures(String(userMessage));
      if (allMeasures.length >= 2) {
        const { findProductInFamilies } = require("./tools");
        const { resolvePrice, trackedLink, fmtMoney } = require("./priceResolver");
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
          const pi = await resolvePrice(doc, altOpt(state, doc));
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
            lines.push(`  • ${tag}: ${fmtMoney(pi)}${link ? ` → ${link}` : ""}`);
            customerLines.push(`• ${tag}: ${fmtMoney(pi)}${link ? ` → ${link}` : ""}`);
            noteQuoted(d, pi);
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
          const { resolvePrice, trackedLink, fmtMoney } = require("./priceResolver");
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
              const pi = await resolvePrice(doc, altOpt(state, doc));
              if (pi && pi.amount) {
                noteAmount(pi, false);
                const link = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: doc.name, productId: String(doc._id) });
                if (pi.quoteThenHandoff || (pi.handoff && !link)) { needHandoff = true; turnHandoffReason = turnHandoffReason || `Cotización ${n} m: sin link — concretar con un asesor`; }
                lines.push(`  • ${n} m: ${fmtMoney(pi)}${link ? ` → ${link}` : ""}`);
                customerLines.push(`• ${n} m: ${fmtMoney(pi)}${link ? ` → ${link}` : ""}`);
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

      // ── "¿POR QUÉ LA DE 6x4 ES MÁS CARA QUE LA DE 4x5?" ───────────────────
      // A price COMPARISON is answered from the two prices we actually quoted, never
      // from a rule of thumb. The rule of thumb WAS a prompt directive (added
      // 2026-07-20, "el precio va por ÁREA, una 6x4 son 24 m² y una 6x6 son 36 m²"),
      // and on 2026-10-23 it told a customer the 6x4 "lleva más material y sube más"
      // one message after quoting it at $649 against $739 for the 4x5 — the bot
      // contradicting its own numbers, 2/2 on replay. The 6x4 is the PROMO measure:
      // its LIST price is the higher one ($1356 vs $1125) and its discount is deeper,
      // which is the entire reason it ends up cheaper. So: the LIST price does go by
      // m², the price the customer pays does not, and only the two numbers in front
      // of us can say which way it falls. The customer's premise may also be backwards
      // (it was here) — correct it, don't echo it.
      const cmpAsk = (() => {
        const t = String(userMessage || "");
        const why = /\b(?:por\s*qu[eé]|porqu[eé]|a\s*qu[eé]\s+se\s+debe|diferencia)\b/i.test(t);
        const cmp =
          /\bm[aá]s\s+(?:car[oa]s?|barat[oa]s?|econ[oó]mic[oa]s?)\b/i.test(t) ||
          /\b(?:cuesta|cuestan|sale|salen|vale|valen)\s+m[aá]s\b/i.test(t) ||
          /\bdiferencia\s+(?:de|en)\s+(?:precio|costo)\b/i.test(t);
        return why && cmp;
      })();
      if (cmpAsk && (state.lastQuotes || []).length >= 2) {
        const { fmtMoney } = require("./priceResolver");
        // Prefer the measures named in THIS message; otherwise the last two quoted.
        const named = allMeasures.map((d) => cmpTag(d[0], d[1]));
        const pool0 = state.lastQuotes.filter((q) => named.includes(q.tag));
        const pool = pool0.length >= 2 ? pool0 : state.lastQuotes.slice(-2);
        const byArea = [...pool].sort((a, b) => a.area - b.area);
        const small = byArea[0], big = byArea[byArea.length - 1];
        // Name the measure the way the CUSTOMER said it: the catalogue stores the
        // sides sorted (4x6), he asked for "la de 6x4", and reading his own measure
        // back to him flipped is one more thing that looks like we aren't listening.
        // Read the RAW message, not allMeasures: that helper sorts the sides (so does
        // dimsOf, so does the catalogue), and all three had agreed to tell him his
        // own "6x4" back as "4 x 6".
        const asNamed = new Map(
          [...String(userMessage).matchAll(/(\d+(?:[.,]\d+)?)\s*(?:[x×*]|por)\s*(\d+(?:[.,]\d+)?)/gi)]
            .map((m) => [Number(String(m[1]).replace(",", ".")), Number(String(m[2]).replace(",", "."))])
            .map((d) => [cmpTag(d[0], d[1]), d])
        );
        const nm = (q) => { const d = asNamed.get(q.tag); return d ? `${d[0]} x ${d[1]} m` : `${q.w} x ${q.l} m`; };
        const off = (q) => (q.orig ? Math.round((1 - q.amount / q.orig) * 100) : 0);
        // Another topic riding along → don't let this gate own the whole turn; the
        // model answers everything, with the real reason in context below.
        const restCmp = String(userMessage).replace(/\d+(?:[.,]\d+)?\s*[x×*]\s*\d+(?:[.,]\d+)?/gi, " ");
        const otherCmp =
          /env[ií]|entrega|paga|pago|factur|garant|instalaci|ubicaci|sucursal|color|mayoreo|cu[aá]nt[oa]s\s/i.test(restCmp) ||
          // "más cara que en Mercado Libre / que en otro lado" compares us to someone
          // else, not our two measures to each other.
          /mercado\s*libre|otro\s+lado|otra\s+tienda|competencia|amazon|home\s*depot|internet/i.test(restCmp);
        let cmpTxt = null;
        if (big.area > small.area && big.amount < small.amount) {
          cmpTxt = big.orig
            ? `Al contrario: la de ${nm(big)} te sale MÁS BARATA, ${big.priceTxt} contra ${small.priceTxt} de la de ${nm(small)}. ` +
              `Es una medida en promoción: su precio de lista es $${big.orig} y quedó en ${big.priceTxt} (${off(big)}% menos)` +
              (small.orig ? `, mientras que la de ${nm(small)} va de $${small.orig} a ${small.priceTxt} (${off(small)}% menos)` : "") +
              `. Por eso la más grande cuesta menos. 😊`
            : `Al contrario: la de ${nm(big)} te sale más barata, ${big.priceTxt} contra ${small.priceTxt} de la de ${nm(small)}. ` +
              `Cada medida tiene su propio precio publicado, así que la más grande puede salir más barata. 😊`;
        } else if (big.area > small.area && big.amount > small.amount) {
          cmpTxt =
            `La de ${nm(big)} cubre ${big.area} m² y la de ${nm(small)} ${small.area} m², así que lleva más material: ` +
            `por eso la de ${nm(big)} está en ${big.priceTxt} y la de ${nm(small)} en ${small.priceTxt}` +
            (big.orig || small.orig ? `, ya con el descuento aplicado` : "") + `. 😊`;
        } else if (big.amount === small.amount && big.area !== small.area) {
          cmpTxt = `En realidad las dos están al mismo precio, ${big.priceTxt}: la de ${nm(big)} trae ${big.area} m² y la de ${nm(small)} ${small.area} m². 😊`;
        }
        if (cmpTxt && !otherCmp) {
          history.push({ role: "assistant", text: cmpTxt, nodeId: currentNode.id, at: new Date() });
          return {
            reply: cmpTxt,
            state: { ...state, history, nodeId: currentNode.id },
            diagnostics: {
              workflow: { id: String(workflow._id), name: workflow.name },
              fromNode: { id: currentNode.id, name: currentNode.name },
              toNode: { id: currentNode.id, name: currentNode.name },
              priceComparison: `${big.tag} vs ${small.tag}`,
            },
          };
        }
        if (cmpTxt) turnContextExtra += `\n- COMPARACIÓN DE PRECIO (ya resuelta con los números reales, úsala tal cual): ${cmpTxt}`;
      }

      // AREA WITHOUT SIDES ("5 metros cuadrados", "20 m2"): never resolve a product
      // from it. There is no W×L to match, so the lookup degrades to a text match and
      // can return a leaf from a completely different family (reported: it answered
      // with the borde "Rollo de 54 m" at $1599, in beige, to someone asking about
      // dark malla sombra). Ask for the two sides instead.
      const areaOnly =
        !wantDims &&
        /\b\d+(?:[.,]\d+)?\s*(?:m2|m²|metros?\s+cuadrados?|mts?\s+cuadrados?)\b/i.test(String(userMessage));
      if (areaOnly) {
        const areaN = String(userMessage).match(/\b(\d+(?:[.,]\d+)?)\s*(?:m2|m²|metros?\s+cuadrados?|mts?\s+cuadrados?)\b/i);
        earlyFacts.push(
          `- EL CLIENTE DIO UN ÁREA${areaN ? ` (${areaN[1]} m²)` : ""}, NO una medida. La malla se vende por ANCHO x LARGO, así que NO cotices ningún producto todavía: ` +
            `pregúntale de cuánto por cuánto la necesita (ancho x largo), proponiéndole un ejemplo que dé esa área. NUNCA inventes una medida ni cotices un rollo que no te pidió.`
        );
      }
      const found = multiHandled || areaOnly ? null : await resolveInFamilyMeasure(String(userMessage), familyList, wantDims, { altPos: state.altPos, altProductIds: state.altProductIds });
      if (multiHandled) {
        // handled above
      } else if (found && found.priceInfo) {
        turnPriceInfo = found.priceInfo;
        const pi = found.priceInfo;
        noteQuoted(wantDims, pi);
        // This is the measure the customer asked about THIS turn → the canonical
        // price + the rewrite target for the clamp.
        noteAmount(pi, true);
        if (pi.soldOut) {
          // Active but out of stock → acknowledge AND hand off (capture the lead
          // so a human follows up / notifies when it returns).
          const askedMeasure = wantDims ? dimTxt(wantDims, "m") : found.name;
          turnHandoffReason = `Producto AGOTADO ${askedMeasure}: ${pi.handoffReason || "sin stock — pasar con un asesor"}`;
          turnHandoffPreface = `Sí manejamos la medida ${askedMeasure}, pero por el momento está agotada.`;
          turnContextExtra =
            `\n- PRODUCTO AGOTADO + HANDOFF: la medida ${askedMeasure} está AGOTADA; el sistema la pasará con un asesor para darle seguimiento. ` +
            `Acláralo con naturalidad; NO compartas link ni la cotices para comprar; NUNCA digas que no la vendemos.`;
        } else if (pi.quoteThenHandoff) {
          // Price resolved but NO purchase link → quote it AND hand off to close.
          // No link ⇒ NOT a Mercado Libre listing with free shipping baked in, so
          // the price does NOT include shipping: the quote must say "+ envío".
          const askedMeasure = wantDims ? dimTxt(wantDims, "m") : found.name;
          turnHandoffReason = `Cotización ${askedMeasure}: ${pi.handoffReason || "sin link de compra — concretar con un asesor"}`;
          turnHandoffPreface = `La medida ${askedMeasure} tiene un precio de ${fmtMoney(pi)} + envío.`;
          turnContextExtra =
            `\n- COTIZA + HANDOFF: la medida ${askedMeasure} cuesta ${fmtMoney(pi)} pero NO tiene link de compra en línea; ` +
            `este precio NO incluye envío, así que dilo SIEMPRE como "${fmtMoney(pi)} + envío" (más el costo de envío). ` +
            `El sistema la pasará con un asesor para concretar. Dile el PRECIO + envío y que un asesor le ayuda a concretar la compra; NO inventes un link.`;
        } else if (pi.handoff) {
          // Reference the ACTUAL measure the customer asked for (never the leaf
          // name like "Color Beige", which made the model invent a size such as
          // "7x10"). Fire a real handoff with the deterministic reason.
          const askedMeasure = wantDims ? dimTxt(wantDims, "m") : found.name;
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
            ? ` Este precio NO incluye envío: al cotizar dilo SIEMPRE como "${fmtMoney(pi)} + envío" (más el costo de envío).`
            : "";
          // The customer asked for a shade % we don't stock in this size → clarify.
          const sm = found.shadeMismatch;
          const shadeNote = sm
            ? `\n- ACLARA LA SOMBRA (obligatorio): el cliente pidió ${sm.requested}%, pero en la medida ${dimTxt(wantDims) || "esa"} NO manejamos ${sm.requested}%. Lo que le vas a ofrecer es ${sm.actual}%${sm.available && sm.available.length ? ` (disponibles en esa medida: ${sm.available.map((s) => s + "%").join(", ")})` : ""}. DILE con naturalidad que en esa medida no tenemos ${sm.requested}% y ofrécele la de ${sm.actual}% (o las opciones disponibles) — NUNCA la cotices como si fuera ${sm.requested}%.`
            : "";
          const srcTag = pi.marketplace ? ` (compra en ${pi.marketplace})` : pi.source === "ml" ? " (Mercado Libre)" : " (inventario)";
          const altNote = pi.marketplace
            ? ` Este producto se compra en ${pi.marketplace}: comparte SU link y, si preguntan por compra/envío/devoluciones, dile que son con ${pi.marketplace}; NO menciones Mercado Libre ni "compra protegida de Mercado Libre" para este producto.`
            : "";
          turnContextExtra =
            `\n- COTIZACIÓN SOLICITADA AHORA: el cliente pregunta por "${found.name}". Precio ${fmtMoney(pi)}${disc}${srcTag}.` +
            altNote +
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
          // RETURN THE QUOTE OURSELVES for the plain case. Everything is already
          // resolved (exact product, price, discount, link) — handing it to the model
          // to phrase left room for it to stall ("¿te comparto info de esa medida?"
          // instead of quoting; ~0.5% of replies, reported). The measure is still
          // parsed by the AI and the price still comes from the live lookup; only the
          // wording of this one sentence becomes fixed.
          // NOT taken when the same message raises anything else (a question, envío,
          // pago, color…): then the model answers everything, using the context above.
          // A message may deserve several answers — this must never swallow one.
          // Only when the customer actually named a W×L. Without dims, `found` comes
          // from a TEXT match that can land on any family ("5 metros cuadrados" scored
          // the borde "Rollo de 54 m"), and sizeTxt falls back to that leaf's name — so
          // the sentence asserts a product nobody asked about.
          if (link && !sm && Number.isFinite(pi.amount) && wantDims) {
            // The test is NOT "no extra words" — people write "es de 10 x 5 la que
            // necesito si la maneja". It's "does this message raise any OTHER topic".
            // If it doesn't, the quote IS the whole answer and we return it.
            const rest = String(userMessage).replace(/\d+(?:[.,]\d+)?\s*[x×*]\s*\d+(?:[.,]\d+)?/gi, " ");
            const otherTopic =
              /env[ií]|entrega|paga|pago|pagar|contra\s*entrega|tarjeta|transferencia|factur|garant|instalaci|sucursal|ubicaci|direcci|d[oó]nde|color|negro|verde|blanco|mayoreo|descuento|cu[aá]nt[oa]s\s|rollo|borde|antimaleza|ground|kit|cord[oó]n|lluvia|impermeable|dura|duraci[oó]n/i.test(rest);
            const secondMeasure = extractAllMeasures(String(userMessage)).length > 1;
            const onlyTheMeasure = !otherTopic && !secondMeasure;
            if (onlyTheMeasure) {
              const sizeTxt = dimTxt(wantDims) || found.name;
              const discTxt = pi.hasDiscount && Number.isFinite(pi.originalPrice) && pi.originalPrice > pi.amount
                ? `, rebajada de $${Math.round(pi.originalPrice)}`
                : "";
              // Never assert beige: say the colour the RESOLVED leaf actually is, and
              // say nothing when it isn't a colour leaf. Borde is negro, ground cover
              // is negro/blanco — all of them were being quoted "en beige".
              const leafColor = String(found.name || "").match(/\b(beige|negro|negra|verde|blanco|blanca|gris)\b/i);
              const colorTxt = leafColor ? ` en ${leafColor[1].toLowerCase()}` : "";
              // THE COLOR CHOICE RIDES ALONG WHEN IT COSTS NOTHING TO OFFER (client's
              // rule, 2026-10-23). This sentence used to name the ONE color the lookup
              // happened to resolve — beige, nearly always, since it is first — so a
              // customer asking for a size learned there was a single color. When the
              // size's colors all price the same, the price is said once and every color
              // is offered with its own link. When they DON'T price the same (six
              // confeccionada sizes genuinely differ: 6x4 m is $649/$729/$1320), the
              // resolved color and its own price stay as they were — quoting three
              // numbers nobody asked for is not "easier for the customer".
              const ccQ = await colorChoiceForProduct(found, {
                self: pi,
                resolve: (d) => resolvePrice(d, altOpt(state, d)),
                link: (q, d) =>
                  require("./priceResolver").trackedLink(q.link, {
                    psid: opts.psid || null,
                    sandbox: !!opts.sandbox,
                    productName: d ? d.name : found.name,
                    productId: String((d || found)._id),
                  }),
              });
              // The ad or the promo may already have fixed the color — this leaf IS the
              // preloaded product — and the customer naming a color never reaches here at
              // all (a color word puts the turn on the `otherTopic` path). With the color
              // settled there is nothing to ask and nothing to offer: quote it.
              const fixedByAd =
                state.product && state.product._id && String(state.product._id) === String(found._id);
              const ctQ = colorChoiceText(ccQ);
              if (ccQ && ccQ.allSame) {
                directQuote =
                  `Sí, la de ${sizeTxt} está en ${fmtMoney(pi)}${discTxt}${ctQ.suffix}.` +
                  (ctQ.lines ? `\n${ctQ.lines}` : ` Aquí la compras: ${link}`);
              } else if (ccQ && ctQ.ask && !fixedByAd) {
                // Prices differ and nothing has chosen for them ⇒ ask, per the client's
                // rule. Quoting beige here (beige resolves first, so it almost always won)
                // told the customer a price for a color they never picked.
                directQuote = `La ${sizeTxt} la tenemos en ${ctQ.colorsOr}, ${ctQ.ask}`;
              } else {
                directQuote =
                  `Sí, la de ${sizeTxt}${colorTxt} está en ${fmtMoney(pi)}${discTxt}. ` +
                  `Aquí la compras: ${link}`;
              }
            }
          }

          const askedQty = require("./tools").parseRollQuantity(String(userMessage));
          if (askedQty && askedQty >= 2 && Number.isFinite(pi.amount)) {
            const total = pi.amount * askedQty;
            allowedAmounts.push(total); // whitelist the total so the price clamp doesn't rewrite it to the unit price
            turnContextExtra +=
              `\n- CANTIDAD: el cliente quiere ${askedQty} piezas de ${found.name}. Cada una ${fmtMoney(pi)}; ` +
              `el TOTAL por ${askedQty} piezas es ${fmtMoney({ ...pi, amount: total })}. Dile el total y comparte el link (en Mercado Libre elige la cantidad ${askedQty}).`;
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
        if (directQuote) {
          history.push({ role: "assistant", text: directQuote, nodeId: currentNode.id, at: new Date() });
          return {
            reply: directQuote,
            state: {
              ...state,
              history,
              nodeId: currentNode.id,
              activeProductId: turnActiveProductId || state.activeProductId || null,
              priceInfo: turnPriceInfo || state.priceInfo || null,
              availableColors: turnColors || state.availableColors || null,
            },
            diagnostics: {
              workflow: { id: String(workflow._id), name: workflow.name },
              fromNode: { id: currentNode.id, name: currentNode.name },
              toNode: { id: currentNode.id, name: currentNode.name },
              directQuote: found.name,
            },
          };
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
            const { resolvePrice, trackedLink, fmtMoney } = require("./priceResolver");
            const refFams = await reforzadaFamilies();
            const refLeaf = refFams.length ? await toolsMod.findProductInFamilies(String(userMessage), refFams, wantDims) : null;
            if (refLeaf) {
              const pi = await resolvePrice(refLeaf, altOpt(state, refLeaf));
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
        // The customer named a MEASURE not exact in catalog (13x3, 8x10, 4.5x4.5,
        // decimals). THE RULE: always offer the CLOSEST AVAILABLE size — NEVER hand
        // off, deny, or say "medida especial" for a size we can approximate. Ceil the
        // fractional sides first (2.8x2.9→3x3, 4.5x4.5→5x5; never undersize), then pick
        // the nearest real size and offer it DETERMINISTICALLY — the model kept
        // overriding the soft directive with an asesor handoff (reported: 8x10→asesor,
        // 6x12→asesor, 10x10→asesor instead of offering 7x10 / 6x10 / 8x8).
        const wantCeil = [Math.ceil(wantDims[0]), Math.ceil(wantDims[1])].sort((a, b) => a - b);
        const closest = (oobHandled || mentionedReforzada) ? null : await toolsMod.closestAvailableMeasure(null, familyList, wantCeil);
        if (closest) {
          usedClosestMeasure = true; // reply names the nearest size, not the requested one
          let cAmount = Number.isFinite(closest.price) && closest.price > 0 ? closest.price : null;
          let cOrig = null, cLink = null, cId = null;
          try {
            const cDoc = await toolsMod.findProductInFamilies(closest.size || closest.label || "", familyList, closest.dims);
            if (cDoc) {
              cId = String(cDoc._id);
              const { resolvePrice, trackedLink, fmtMoney } = require("./priceResolver");
              const cpi = await resolvePrice(cDoc, altOpt(state, cDoc));
              if (cpi && cpi.amount) {
                cAmount = cpi.amount;
                cOrig = cpi.hasDiscount && Number.isFinite(cpi.originalPrice) && cpi.originalPrice > cpi.amount ? Math.round(cpi.originalPrice) : null;
                cLink = await trackedLink(cpi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: cDoc.name, productId: cId });
              }
            }
          } catch (err) {
            console.error("⚠️ closest price/link resolve failed:", err.message);
          }
          if (Number.isFinite(cAmount) && cAmount > 0) {
            // DETERMINISTIC offer of the closest available size — enforces the rule so
            // the model can't hand off on the size. Clean size from dims (labels can be
            // a full product name), price + tracked link, and bind it as the active
            // product so a follow-up ("sí, la quiero") resolves to it.
            const cSize = closest.dims ? `${closest.dims[0]}m x ${closest.dims[1]}m` : (closest.label || "esa medida");
            const isExact = closest.dims && closest.dims[0] === wantCeil[0] && closest.dims[1] === wantCeil[1];
            const priceStr = `$${cAmount}${cOrig ? ` (rebajado de $${cOrig})` : ""}`;
            // Lead with the OFFER (never a "no la manejo" that reads as a flat denial —
            // we DO make sobre medida; we're just proposing the closest ready size).
            const lead = isExact
              ? `Para tu medida de ${wantDims[0]}x${wantDims[1]} m te queda la de ${cSize} en ${priceStr}.`
              : `La medida que manejo más cercana a tu ${wantDims[0]}x${wantDims[1]} m es la de ${cSize}, en ${priceStr}.`;
            // Affirm sobre-medida for a genuinely different size (NEVER deny custom —
            // Hanlob does make it) — but the closest BUYABLE size stays the primary offer.
            const customNote = isExact ? "" : ` Y si la necesitas exacta, también la hacemos a tu medida. 😊`;
            const reply = lead + (cLink ? ` Aquí la compras: ${cLink}` : "") + customNote;
            if (cId) state.activeProductId = cId;
            history.push({ role: "assistant", text: reply, nodeId: currentNode.id, at: new Date() });
            return {
              reply,
              state: { ...state, history, nodeId: currentNode.id },
              diagnostics: {
                workflow: { id: String(workflow._id), name: workflow.name },
                fromNode: { id: currentNode.id, name: currentNode.name },
                toNode: { id: currentNode.id, name: currentNode.name },
                closestMeasureOffered: cSize,
                requestedMeasure: `${wantDims[0]}x${wantDims[1]}`,
              },
            };
          }
          // NEAREST SIZE FOUND BUT NOT QUOTABLE (no live price / no link) → offer it,
          // then hand off. "Nothing to quote ⇒ escalate" is the oldest rule in the
          // project; it was dropped in 37cf982 (2026-05-27) when the promo-cage fix
          // replaced the escalation branch with a catalog-wide search and left no
          // floor under it, and the workflow cutover never brought it back. Note this
          // is NOT a handoff over the SIZE (that stays forbidden — the branch above
          // offers any size we can price); it's a handoff because we have no price to
          // give, which is the one thing the bot must never improvise.
          const _cSizeNP = closest.dims ? `${closest.dims[0]}m x ${closest.dims[1]}m` : (closest.label || "esa medida");
          return beginHandoff({
            preface: `La medida que manejo más cercana a tu ${wantDims[0]}x${wantDims[1]} m es la de ${_cSizeNP}, pero deja confirmo el precio contigo.`,
            reason: `Medida ${wantDims[0]}x${wantDims[1]} m — la más cercana (${_cSizeNP}) no tiene precio en línea; cotizar con asesor`,
          });
        }
        if (!oobHandled && !mentionedReforzada) {
          // NOTHING in the catalog comes close to the requested measure → nothing to
          // quote at all. Same restored rule: never leave the customer with a question
          // or an improvised answer — affirm we make it and escalate with the measure.
          return beginHandoff({
            preface: `Tu medida de ${wantDims[0]}x${wantDims[1]} m sí la fabricamos a la medida.`,
            reason: `Medida ${wantDims[0]}x${wantDims[1]} m sin equivalente en catálogo — cotización sobre medida con asesor`,
          });
        }
      } else if (turnActiveProductId) {
        // NO measure in THIS message, but there's an ACTIVE product (e.g. the
        // customer asked "3x4" earlier and now just says "Porfa"/"sí"). The price
        // is BOUND to the product: re-resolve ITS price from ML (first rule) so a
        // follow-up never reverts to the promo/default price.
        const PF = require("../../models/ProductFamily");
        const { resolvePrice, trackedLink, fmtMoney } = require("./priceResolver");
        const doc = await PF.findById(turnActiveProductId).lean().catch(() => null);
        if (doc && doc.sellable) {
          const pi = await resolvePrice(doc, altOpt(state, doc));
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
            turnHandoffPreface = `"${doc.name}" (${doc.size || ""}) tiene un precio de ${fmtMoney(pi)}.`;
            turnContextExtra =
              `\n- COTIZA + HANDOFF: "${doc.name}" (${doc.size || ""}) cuesta ${fmtMoney(pi)} pero NO tiene link de compra en línea; ` +
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
              `\n- PRODUCTO ACTIVO: el cliente sigue tratando "${doc.name}" (${doc.size || ""}). Precio ${fmtMoney(pi)}${disc}${pi.source === "ml" ? " (Mercado Libre)" : " (inventario)"}.` +
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
  const effectiveContext =
    (promoAlreadyShown
      ? contextBlock.split("\n").filter((l) => !l.includes("§D§")).join("\n")
      : contextBlock.replace(/§D§/g, "")) +
    // Facts the early gates contributed this turn (payment, etc.) — appended here so
    // they survive the gates that overwrite turnContextExtra, and so the ROUTER sees
    // them too (it was the router that used to escalate payment questions).
    (earlyFacts.length ? "\n" + earlyFacts.join("\n") : "");

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
    altPos: state.altPos || null, // campaign-scoped alternate marketplace (POS doc)
    altProductIds: state.altProductIds || [], // product ids routed to the alt POS
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
      // §4 of the campaign rules: every channeled customer arrives with nombre,
      // teléfono AND código postal. Asking for the zip later (the delivery-framed
      // gate) only fires on the purchase path, so wholesale handoffs reached the
      // asesor with no CP and the logistics question had to be asked again.
      const _name = (ctx.lead && ctx.lead.name) || (state.lead && state.lead.name) || opts.profileName || null;
      const ask = `${preface}¡Con gusto te paso con un asesor! 🙌 ¿Me compartes ${_name ? "" : "tu nombre, "}un teléfono a 10 dígitos y tu código postal para que te contacte?`;
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
          pendingHandoff: { reason: ctx.handoffReason || null, attempts: 1, askedAt: new Date() },
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

  // DETERMINISTIC ALT-LINK ENFORCEMENT — runs LAST. When THIS turn quoted a product
  // routed to an alternate marketplace, the buy link must point to that store, never
  // Mercado Libre. The model/verifier sometimes re-emits a raw ML URL it saw earlier
  // in the conversation; rewrite any ML URL to the tracked alt-store link. Gated on
  // the TURN's own quoted product (turnPriceInfo), so a non-routed measure (e.g. a
  // 5x8 quoted from ML) is never touched.
  if (text && turnPriceInfo && turnPriceInfo.marketplace && turnPriceInfo.link && /mercadolibre\.com/i.test(text)) {
    try {
      const { enforceAltMarketplaceLink } = require("./priceResolver");
      const enforced = await enforceAltMarketplaceLink(text, {
        altLink: turnPriceInfo.link,
        psid: opts.psid || null,
        sandbox: !!opts.sandbox,
        productName: (state.product && state.product.name) || null,
        productId: turnActiveProductId || (state.product && state.product._id ? String(state.product._id) : null),
      });
      if (enforced !== text) {
        console.warn(`🔗 [workflow] enforced alt-marketplace link (${turnPriceInfo.marketplace}) for ${opts.psid || "(no psid)"}`);
        text = enforced;
      }
    } catch (e) {
      console.error("⚠️ alt-link enforce failed:", e.message);
    }
  }

  // AN UNFILLED PLACEHOLDER MUST NEVER REACH A CUSTOMER (2026-10-28, reported).
  // Three WhatsApp customers were sent "- Rollo de 6 m: [precio]" four lines over, on
  // the borde flow: the ad preloads the FAMILY, so no price is in context, and the
  // model — told to share prices — wrote the TOKEN where the number goes. The same
  // leak exists for every template variable: `applyVars` fills [first_name]-style
  // placeholders from the vars bag and LEAVES the token verbatim when the var is
  // missing. A reply still carrying one is a template, not an answer, so it is dropped
  // here — the engine's rescue ladder (cold start → last resort, `ai/index.js`) then
  // answers the turn with real numbers, which is what a price-less list was failing to
  // do anyway. Markdown links ("[texto](url)") are not placeholders; neither is
  // anything with a space or a digit in the brackets ("[Reacción enviada]").
  if (text) {
    const ph = String(text).match(/\[[a-záéíóúñ_]{3,20}\](?!\()/i);
    if (ph) {
      console.error(
        `🚫 [workflow] dropped a reply with an unfilled placeholder ${ph[0]} for ${opts.psid || "(no psid)"} ` +
          `(node ${movedTo.id}) — falling through to the rescue ladder`
      );
      text = null;
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
  // A product we MAKE but no active flow covers (needs_human — e.g. monofilamento):
  // check_product_scope set handoffRequested on the probe. Surface it so the caller
  // hands off to a human instead of substituting a lookalike active-flow product.
  if (probe.handoffRequested) {
    return { needsHuman: true, reason: probe.handoffReason || null };
  }
  return null;
}

// If the customer's message contains a measure (e.g. "4x3") that exists in this
// flow's families, resolve its price/link. Returns { name, priceInfo } or null.
// wantDims is the AI-extracted measure from the customer message (passed in so
// we don't re-extract); only fires for measure messages so plain "precio" keeps
// the preloaded one.
async function resolveInFamilyMeasure(message, familyList, wantDims, routeOpts = {}) {
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
  // Honor campaign alternate-marketplace routing for the resolved leaf (same rule
  // as altOpt): quote via the alt POS when this product is routed there.
  const altIds = routeOpts && routeOpts.altProductIds;
  const altOpt =
    routeOpts && routeOpts.altPos && Array.isArray(altIds) && altIds.map(String).includes(String(doc._id))
      ? { altPos: routeOpts.altPos }
      : {};
  return { name: doc.name, id: String(doc._id), priceInfo: await resolvePrice(doc, altOpt), variants, shadeMismatch };
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
