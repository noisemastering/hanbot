// utils/wireMesh.js
//
// WE DO NOT MAKE WIRE OR RIGID MESH, AND SAYING SO IS AN ANSWER (2026-11-02,
// wa:5213311303031, "no respondió lo que se preguntó").
//
// The customer sent a Facebook video and wrote "Hola no venden este tipo de Maya?",
// then "en el vídeo q te envíe ando buscando ese tipo de Maya", then "La maya donde
// sercan alas cabras?". The bot kept offering malla sombra and then jumped to asking
// for his phone and CP, so Noemí answered it by hand: *"buscas una malla tipo alambre.
// Por el momento no manejamos ese tipo de malla. No contamos con mallas rígidas;
// nuestras mallas son flexibles. Sin embargo, tenemos una opción que puede funcionar
// como barrera física para delimitar o proteger áreas."*
//
// This is the ONE predicate for it, so the gate in the engine and the scope classifier's
// rule can never drift apart. It is deliberately narrow in one specific way: **"cercar"
// alone is NOT evidence**. Our flexible mesh genuinely can be used to close off or
// protect an area — that is the alternative Noemí offered — so a question like "¿la
// malla sombra sirve para cercar mi terreno?" must reach the normal answer. It takes a
// WIRE or RIGID marker (alambre, ciclónica, electrosoldada, hexagonal, reja, gallinero,
// borreguera, púas…), or a fencing word paired with an animal we'd be fencing in.
//
// Tests: node scripts/wireMeshTest.js

// Spanish word ends: a trailing \b can never match after an accented vowel, and that
// silently disabled an exclusion once already (the gcFollowUp "compré" trap).
const END = "(?![a-záéíóúñ])";

// Unmistakably wire or rigid: no other product of ours is called any of these.
const WIRE = new RegExp(
  "\\b(" +
    "alambr(?:e|es|ada|ado|adas|ados)|" +
    "cicl[oó]nic[oa]s?|" +
    "electrosoldad[oa]s?|" +
    "hexagonal(?:es)?|" +
    "p[uú]as?|" +
    "gallinero|" +
    "borreguer[oa]s?|" +
    "ganader[oa]s?|" +
    "malla\\s+r[ií]gida|" +
    "mallas\\s+r[ií]gidas|" +
    "malla\\s+met[aá]lica|" +
    "mallas\\s+met[aá]licas|" +
    "rej(?:a|as)|" +
    "enrejad[oa]s?|" +
    "cerca\\s+el[eé]ctrica" +
  ")" + END,
  "i"
);

// Fencing + livestock. "La maya donde sercan alas cabras" has no wire word in it at all
// — it is the USE that gives it away, and the customer's spelling is nobody's fault.
const FENCE = /\b(cerc\w*|serc\w*|corral\w*|potrer\w*|delimitar\s+el\s+ganado)/i;
const LIVESTOCK = /\b(cabras?|chivos?|borregos?|ovejas?|vacas?|ganado|caballos?|gallinas?|puercos?|cerdos?|animales?)/i;

/**
 * Is this message asking for wire / rigid mesh, which Hanlob does not make?
 *
 * @param {string} text the customer's message, as they wrote it
 * @returns {boolean}
 */
function asksWireMesh(text) {
  const t = String(text || "");
  if (!t.trim()) return false;
  if (WIRE.test(t)) return true;
  return FENCE.test(t) && LIVESTOCK.test(t);
}

/**
 * What the bot says back. Noemí's own answer, in three parts: we don't make it, ours are
 * flexible, and there IS something here that works as a barrier — then one question so
 * the conversation continues instead of ending on a "no". It promises nothing we can't
 * back: no price, no measure, and no catalogue (the global catalogue PDF is currently
 * the distributor price list, which is its own pending item).
 *
 * @returns {string}
 */
function wireMeshAnswer() {
  return (
    "No manejamos malla de alambre ni mallas rígidas: las nuestras son de tejido flexible " +
    "(malla sombra, malla antimaleza y borde separador). " +
    "Si lo que necesitas es delimitar o proteger un área, sí tenemos opciones que funcionan como barrera. " +
    "¿Para qué la necesitas y qué medida andas buscando? 😊"
  );
}

module.exports = { asksWireMesh, wireMeshAnswer };
