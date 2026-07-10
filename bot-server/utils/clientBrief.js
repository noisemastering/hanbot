// utils/clientBrief.js
//
// Builds a concise "what the bot knows so far" brief from a Conversation doc so
// a human taking over a handoff understands the situation without reading the
// whole thread. Returns a single " · "-separated line (good for a push
// notification body and for a side panel). Only includes facts that are present.
function first(...xs) {
  for (const x of xs) if (x !== undefined && x !== null && x !== "") return x;
  return null;
}

function buildClientBrief(convo) {
  if (!convo) return "";
  const c = typeof convo.toObject === "function" ? convo.toObject() : convo;
  const specs = c.productSpecs || {};
  const parts = [];

  const name = first(c.extractedName, specs.customerName, c.profileName);
  if (name) parts.push(`Cliente: ${name}`);

  // Prefer the structured contact; if missing, salvage a phone the model left in
  // the handoff reason (older handoffs predate deterministic capture).
  let contact = first(c.leadData && c.leadData.contact);
  if (!contact && c.handoffReason) {
    try {
      const { extractPhone } = require("../ai/workflow/handoffGate");
      contact = extractPhone(c.handoffReason);
    } catch {
      /* ignore */
    }
  }
  if (contact) parts.push(`Contacto: ${contact}`);

  const loc =
    [first(c.city), first(c.stateMx)].filter(Boolean).join(", ") || first(c.zipCode, c.zipcode);
  if (loc) parts.push(`Ubicación: ${loc}`);

  const product = first(c.poiRootName, c.productInterest, specs.productType);
  if (product) parts.push(`Producto: ${product}`);

  const dims = first(
    specs.size,
    specs.dimensions,
    specs.width && specs.length ? `${specs.width}x${specs.length}` : null
  );
  const detail = [];
  if (dims) detail.push(dims);
  if (specs.percentage) detail.push(`${specs.percentage}%`);
  if (specs.color) detail.push(specs.color);
  if (specs.quantity) detail.push(`${specs.quantity} pza(s)`);
  if (detail.length) parts.push(`Especificaciones: ${detail.join(", ")}`);

  if (c.adHeadline || c.campaignRef || c.adId) {
    parts.push(`Origen: ${c.channel || "anuncio"}${c.adHeadline ? ` (${c.adHeadline})` : ""}`);
  }

  if (c.lastIntent) parts.push(`Último interés: ${c.lastIntent}`);
  if (c.handoffReason) parts.push(`Motivo handoff: ${c.handoffReason}`);

  return parts.length ? parts.join(" · ") : "Sin datos capturados aún.";
}

module.exports = { buildClientBrief };
