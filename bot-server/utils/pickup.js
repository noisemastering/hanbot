// utils/pickup.js
//
// "YO LO PASO A RECOGER Y A PAGAR" IS A QUESTION ABOUT WHERE WE ARE (2026-11-06, psid
// 28881861821437120, "No respondió lo que se preguntó").
//
// Ernesto had already been quoted the 18 m roll and said he would come and pay in
// person. He got the payment answer — Mercado Libre, transferencia, "si pasas a la
// tienda puedes pagar ahí" — and then "¿Qué largo necesitas? 😊", a length he had given
// twenty minutes earlier. **Nobody told him where the plant is.** Noemí came in at the
// end and sent exactly that: the address and the Google Maps link.
//
// The word "pagar" is why: the borde's payment gate (0-ter) owns any message with
// pago/pagar in it, and it ran first. A pickup is not a payment question — it is a
// LOCATION question with a payment detail attached, and the one thing the customer
// needs is where to go, when, and that he can pay there.
//
// Pickup answers existed, but only in the LEGACY paths (ai/global/intents.js,
// ai/handlers/logistics.js, ai/utils/locationIntent.js), which the workflow engine never
// reads — the standing "legacy answers are stranded" trap. This is the engine's copy,
// and the only one that is in force.
//
// Tests: node scripts/pickupTest.js

const END = "(?![a-záéíóúñ])";

// Coming to get it. The reported message is "Yo lo paso a recoger y a pagar"; the rest
// is how the same intent arrives in the real transcripts.
const PICKUP = new RegExp(
  "(" +
    // recoger / recojo, in any person
    "recoger" + END + "|recojo" + END + "|recogerl[oa]s?" + END + "|recogerlos" + END + "|" +
    "paso\\s+por\\s+(?:[eé]l|ella|ellos|los|las|mi\\s+pedido|el\\s+pedido|ellos)|" +
    "voy\\s+por\\s+(?:[eé]l|ella|ellos|mi\\s+pedido|el\\s+pedido)|" +
    "pas[oa]r?\\s+a\\s+(?:la\\s+)?(?:tienda|planta|bodega|sucursal|f[aá]brica)|" +
    "(?:ir|pasar|llegar)\\s+(?:a|hasta)\\s+(?:su|la)\\s+(?:tienda|planta|bodega|sucursal|f[aá]brica)|" +
    "comprar(?:l[oa]s?)?\\s+(?:en|de)\\s+persona|" +
    "(?:en|de)\\s+(?:su|la)\\s+(?:tienda|planta|bodega|sucursal)\\s+(?:lo|la|los|las)\\s+(?:compro|puedo)|" +
    "puedo\\s+(?:ir|pasar)\\s+(?:a|por)\\b" +
  ")",
  "i"
);

// Cash on delivery is the OTHER thing, and the company answer for it is "no" plus the
// one exception (paying at the store). It must not come out of here: paymentAnswer owns
// it, and a COD question is not someone telling us they will drive over.
const COD = /\bcontra\s*entrega\b|\bcontraentrega\b|\bpago\s+al\s+(?:recibir|recibirlo|entregar)\b|\bpagar\s+al\s+recibir\b/i;

// Mercado Libre's own pickup points are not our plant.
const ML_POINT = /\bpunto[s]?\s+de\s+entrega\b|\bsucursal\s+de\s+(?:dhl|fedex|estafeta|paquetexpress)\b|\boxxo\b/i;

/**
 * Is the customer saying they will come and pick the order up (or asking whether they
 * can)?
 *
 * @param {string} text the customer's message, as they wrote it
 * @returns {boolean}
 */
function asksPickup(text) {
  const t = String(text || "");
  if (!t.trim()) return false;
  if (COD.test(t)) return false;
  if (ML_POINT.test(t)) return false;
  return PICKUP.test(t);
}

/**
 * What the bot says. Three facts and nothing invented: yes you can pick it up, here is
 * where we are (from CompanyInfo, through the caller's locationBlock — never a literal),
 * and you pay there. The money rule is the company one — always up front — and paying at
 * the store is its one exception, which is exactly this case.
 *
 * @param {object} o
 * @param {string[]} [o.locationLines] locationBlock() output: address + Maps + notices
 * @param {string}   [o.hours] business hours, when CompanyInfo has them
 * @param {boolean}  [o.knowWhatTheyWant] true when a measure is already on the table —
 *                   then we must NOT ask for it again, which is what was reported
 * @returns {string}
 */
function pickupAnswer({ locationLines, hours, knowWhatTheyWant } = {}) {
  const parts = [
    "¡Claro que sí! Puedes pasar por tu pedido a nuestra planta y pagar ahí mismo con tarjeta, efectivo o transferencia. 🏭",
  ];
  if (Array.isArray(locationLines) && locationLines.length) parts.push(locationLines.join("\n"));
  if (hours) parts.push(`🕒 Horario: ${hours}`);
  parts.push(
    knowWhatTheyWant
      ? "¿Te lo dejamos preparado para cuando pases?"
      : "¿Qué medida y cuántas piezas te preparamos?"
  );
  return parts.join("\n");
}

module.exports = { asksPickup, pickupAnswer };
