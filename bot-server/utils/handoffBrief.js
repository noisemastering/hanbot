// utils/handoffBrief.js
//
// Turns a handed-off Conversation into the brief a salesperson reads INSTEAD of
// the thread: what the customer wants, what the asesor has to do next, and how
// urgent it is relative to everything else in the queue.
//
// Why a priority at all: a survey of the last 400 handoffs found ~13% of the
// queue is not a customer need at all (image-processing failures, temporary AI
// engine faults) and another large slice is a real lead the bot never got a
// phone number for. Those three things demand completely different responses,
// and today they all render the same. The score is what lets the queue sort.
//
// Deterministic on purpose — no model call. It runs on every handoff and on
// every dashboard read, and it must never add latency or cost to either.
function first(...xs) {
  for (const x of xs) if (x !== undefined && x !== null && x !== "") return x;
  return null;
}

// productInterest is stored as a slug ("malla_sombra_raschel"). A salesperson
// reads this line, so render it as words.
function humanize(v) {
  if (!v) return null;
  const s = String(v).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
}

// Reason strings are written by the flows in Spanish; match on their shape.
const RE = {
  // Not a customer request: the bot broke. Must not outrank a real lead.
  system: /error al procesar la imagen|fallo temporal del motor|motor de ia|sin conexi[oó]n|no se pudo leer el precio en vivo/i,
  complaint: /queja|reclamo|molesto|enojad|desconfia|desconfianza|mala experiencia|garant[ií]a|defect|da[ñn]ad/i,
  wholesale: /mayoreo|al por mayor|volumen|distribuidor|revendedor/i,
  quote: /cotiza|cotización|sin precio|sin link|medida|sobre medida|precio especial|no tiene precio/i,
  soldOut: /agotad|sin stock|sold.?out/i,
  noContact: /no proporcion[oó] su informaci[oó]n|sin datos de contacto/i,
};

const LABEL = {
  system: "Falla del sistema",
  complaint: "Queja / inconformidad",
  wholesale: "Mayoreo",
  quote: "Cotización",
  soldOut: "Producto agotado",
  general: "Atención general",
};

const NEXT_STEP = {
  system: "No es una solicitud del cliente: el bot falló. Revisa la conversación y retómala tú.",
  complaint: "Cliente inconforme. Atiéndelo primero y resuelve la queja antes de vender.",
  wholesale: "Prepara la cotización de mayoreo con el precio por volumen y contáctalo.",
  quote: "Cotiza la medida solicitada y mándale precio y forma de compra.",
  soldOut: "Confirma cuándo regresa el producto y avísale; ofrécele una alternativa.",
  general: "Revisa lo que pidió y continúa la venta donde la dejó el bot.",
};

function categoryOf(reason) {
  const r = String(reason || "");
  if (RE.system.test(r)) return "system";
  if (RE.complaint.test(r)) return "complaint";
  if (RE.wholesale.test(r)) return "wholesale";
  if (RE.soldOut.test(r)) return "soldOut";
  if (RE.quote.test(r)) return "quote";
  return "general";
}

// 0–100. Drives the queue order. A lead we can actually phone always outranks
// an identical one we can't, because the asesor can do something about it now.
function scoreOf({ category, hasContact, hasQty, hasLocation }) {
  if (category === "system") return 0; // never competes with a customer
  let s =
    category === "complaint" ? 90 :
    category === "wholesale" ? 70 :
    category === "quote" ? 60 :
    category === "soldOut" ? 45 : 40;
  if (hasContact) s += 20; else s -= 15; // can we call them or not
  if (hasQty) s += 6;
  if (hasLocation) s += 4;
  return Math.max(0, Math.min(100, s));
}

function priorityOf(score, category) {
  if (category === "system") return "sistema";
  if (score >= 75) return "alta";
  if (score >= 50) return "media";
  return "baja";
}

function buildHandoffBrief(convo) {
  if (!convo) return null;
  const c = typeof convo.toObject === "function" ? convo.toObject() : convo;
  const specs = c.productSpecs || {};
  const reason = c.handoffReason || c.pendingHandoffReason || "";

  const name = first(c.extractedName, specs.customerName, c.profileName);
  let contact = first(c.leadData && c.leadData.contact);
  if (!contact && reason) {
    try {
      contact = require("../ai/workflow/handoffGate").extractPhone(reason);
    } catch { /* older handoffs predate deterministic capture */ }
  }
  // The flows stamp this warning into the reason when the customer went silent
  // before giving a number — trust it over a phone salvaged from the text.
  if (RE.noContact.test(reason)) contact = contact || null;

  const location = [first(c.city), first(c.stateMx)].filter(Boolean).join(", ") || first(c.zipCode, c.zipcode);
  // poiRootName sometimes holds a COLOR leaf ("Color Beige") rather than the
  // product — useless to an asesor, so fall through to the real product field.
  const poi = first(c.poiRootName);
  const product = humanize(
    first(poi && !/^color\b/i.test(poi) ? poi : null, c.productInterest, specs.productType, poi)
  );
  const size = first(specs.size, specs.dimensions, c.requestedSize,
    specs.width && specs.length ? `${specs.width}x${specs.length}` : null);
  const qty = first(specs.quantity, c.workflowState && c.workflowState.lead && c.workflowState.lead.wholesaleQty);

  const category = categoryOf(reason);
  const score = scoreOf({ category, hasContact: !!contact, hasQty: !!qty, hasLocation: !!location });
  const priority = priorityOf(score, category);

  // SITUATION — one sentence an asesor can act on without opening the thread.
  const wants = [product, size, qty ? `${qty} pza(s)` : null].filter(Boolean).join(" ");
  const situation =
    category === "system"
      ? `El bot falló durante la conversación${product ? ` (hablaban de ${product})` : ""}. El cliente sigue esperando.`
      : wants
      ? `Quiere ${wants}${location ? ` · ${location}` : ""}.`
      : `Pidió atención de un asesor${location ? ` · ${location}` : ""}.`;

  let nextStep = NEXT_STEP[category];
  if (!contact && category !== "system") {
    nextStep += " Ojo: no dejó teléfono — pídeselo al retomar el chat.";
  }

  return {
    priority,            // alta | media | baja | sistema
    score,               // 0–100, for sorting the queue
    category,            // system | complaint | wholesale | quote | soldOut | general
    categoryLabel: LABEL[category],
    situation,
    nextStep,
    reason: reason || null,
    customer: {
      name: name || null,
      contact: contact || null,
      location: location || null,
      product: product || null,
      size: size || null,
      quantity: qty || null,
    },
  };
}

module.exports = { buildHandoffBrief };
