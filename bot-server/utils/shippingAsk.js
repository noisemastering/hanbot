// utils/shippingAsk.js
//
// ONE OWNER FOR "IS THIS A SHIPPING QUESTION?" (2026-11-04, wa:5217774678321).
//
// He asked "Y modo de entrega" and then "Es entrega a domicilio ??" on the borde flow
// and got the §B catch-all nudge BOTH times — "¡Gracias! Ya te pasé los precios de los
// rollos de 6 m, 9 m, 18 m, 54 m. ¿Cuál te sirve y cuántos necesitas?" — which is the
// standing "a question we can answer must never get the nudge" rule, broken by the very
// gate written for it two days earlier (0-quater, 2026-11-02).
//
// Root cause: both shipping gates (the borde's 0-quater and the ground cover's
// a0-envio) tested for a word from {envío, flete, paquetería, transporte, mensajería}.
// **"entrega" was not in either list**, and "a domicilio" was in neither — yet that is
// how a customer asks whether we deliver. The two gates had the same four regexes
// copy-pasted, so a word added to one would have been missing from the other; they now
// read their triggers from here, which is the same reason paymentAnswer() exists.
//
// Three DIFFERENT questions, because answering one with another is its own bug (the
// 2026-10-28 case: "¿cuánto TARDA el envío?" answered with what it COSTS):
//   • cost  — what the shipping costs / is it included
//   • time  — how long it takes
//   • how   — do you deliver to my door, how is it delivered
// The bodies stay in the flows: the cuts and the full roll differ per product, and only
// the flow knows its own lengths.
//
// Tests: node scripts/shippingAskTest.js

// Spanish word ends: a trailing \b can never match after an accented vowel.
const END = "(?![a-záéíóúñ])";

// The shipping NOUNS, "entrega" included. A bare "entrega" is deliberately here and
// not in the cost test's noun list: see asksShipCost below.
const NOUN = new RegExp("\\b(env[ií]os?|flete|paqueter[ií]a|transporte|mensajer[ií]a)" + END, "i");
const COSTW = /\b(cu[aá]nto|costo|costos|cuesta|precio|cobran|sale|vale|gratis|incluid[oa]s?|incluye|incluyen|aparte|extra|manejan|tienen?|hacen|hay|es\s+el|son)\b/i;
const TIMEW = /\b(tarda\w*|demora\w*|llega\w*|tiempo\s+de\s+(entrega|env[ií]o)|cu[aá]ndo\s+(me\s+)?(llega|lo\s+env|la\s+env))\b/i;

/**
 * What does the shipping COST — including "¿ya viene incluido?".
 *
 * "Gastos de envío" / "costo del envío" / "flete" name the cost by themselves (he wrote
 * exactly "Gastos de Envío" on his third try, 2026-10-30, and the second half of this
 * test wanted a word like "cuánto" that his message never had). The cost of the
 * DELIVERY is spelled out as a phrase rather than by adding bare "entrega" to the noun
 * list, because "¿cuánto tiempo de entrega?" carries "cuánto" and would then read as a
 * cost question — which is the mistake this file exists to stop.
 */
function asksShipCost(text) {
  const t = String(text || "");
  if (!t.trim()) return false;
  if (/\bgastos?\s+de\s+env[ií]o|\bcostos?\s+(?:de|del)\s+(?:la\s+)?(?:env[ií]o|entrega)|\bprecio\s+(?:de|del)\s+(?:la\s+)?(?:env[ií]o|entrega)|\bflete\b/i.test(t)) return true;
  return NOUN.test(t) && COSTW.test(t);
}

/** How LONG it takes. */
function asksShipTime(text) {
  const t = String(text || "");
  if (!t.trim()) return false;
  if (!(TIMEW.test(t) || /\bcu[aá]nt[oa]s?\s+d[ií]as\b/i.test(t))) return false;
  return /\b(env[ií]os?|entregas?|pedido|compra|llega|tarda)\b/i.test(t);
}

/**
 * DO YOU DELIVER, and how — "Y modo de entrega", "Es entrega a domicilio ??",
 * "¿hacen entregas?", "¿me lo mandan hasta mi casa?". No cost word and no time word in
 * any of them, which is why both gates used to miss the lot.
 */
function asksShipHow(text) {
  const t = String(text || "");
  if (!t.trim()) return false;
  return /\b(?:a\s+domicilio|hasta\s+(?:mi|la)\s+(?:casa|domicilio|puerta)|(?:modo|forma|m[eé]todo|tipo)\s+de\s+(?:entrega|env[ií]o)|c[oó]mo\s+(?:es|son|ser[ií]a|funciona|funcionan|manejan|hacen|mandan|env[ií]an)\s+(?:la\s+|el\s+|los\s+|las\s+)?(?:entregas?|env[ií]os?)|entregan?\s+a\s+domicilio|hacen\s+entregas?|hacen\s+env[ií]os?|env[ií]an\s+a\s+domicilio|mandan\s+a\s+domicilio)\b/i.test(t);
}

/** Any of the three — what a gate uses to decide whether to claim the turn. */
function asksShipping(text) {
  return asksShipCost(text) || asksShipTime(text) || asksShipHow(text);
}

/**
 * THE SHIPPING COST WITH NO PRODUCT NAMED YET (2026-11-09, wa:5218180999001).
 *
 * The bodies of the shipping answer live in the flows, because only the flow knows its
 * own cut lengths — but COLD START has no product yet and had no answer at all: his
 * "¿Cuál es el costo de envío?" was answered with three product prices and not one word
 * about shipping. Both halves are true of EVERY product we sell (2026-10-27, 2026-10-28)
 * and neither names a length, so the generic line belongs here beside the predicates
 * rather than as a fourth copy that can drift from the other three.
 */
function genericShipLine() {
  return (
    "Sobre el envío: lo que se compra por Mercado Libre ya lo lleva incluido en el precio, " +
    "y el rollo completo va por flete, que se cotiza según tu código postal."
  );
}

module.exports = { asksShipCost, asksShipTime, asksShipHow, asksShipping, genericShipLine };
