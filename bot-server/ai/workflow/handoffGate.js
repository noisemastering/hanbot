// ai/workflow/handoffGate.js
//
// Collect-before-handoff for the WORKFLOW ENGINE. The legacy flows collected a
// reachable lead before escalating (ai/utils/preHandoffCheck.js via
// executeHandoff); the engine's handoff path (request_handoff tool → triggerHandoff)
// never inherited that, so engine handoffs fired with no contact for the human.
//
// These helpers extract contact deterministically so a phone/name the customer
// already gave is never lost (even when the model doesn't call capture_lead), and
// recognize a bare-name reply to our "¿me das tu nombre y teléfono?" ask.

// A Mexican phone: 10 digits, optionally prefixed with +52 / 52 / 1, tolerant of
// spaces/dashes/dots between groups ("44 3265 5307", "4441748264", "443-265-5307").
function extractPhone(text) {
  const t = String(text || "");
  const matches = t.match(/(?:\+?52[\s.\-]?)?\d(?:[\s.\-]?\d){9}(?!\d)/g) || [];
  for (const c of matches) {
    let d = c.replace(/\D/g, "");
    if (d.length === 13 && d.startsWith("521")) d = d.slice(3);
    else if (d.length === 12 && d.startsWith("52")) d = d.slice(2);
    else if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
    // Valid MX number: 10 digits, first digit 2-9 (no LADA starts with 0/1). This
    // rejects random 10-digit runs (order IDs, concatenated zips/dates) that
    // aren't phones.
    if (d.length === 10 && /^[2-9]/.test(d)) return d;
  }
  return null;
}

// A name stated with a lead-in ("me llamo X", "mi nombre es X", "soy X").
function extractName(text) {
  const t = String(text || "");
  const m = t.match(
    /\b(?:me\s+llamo|mi\s+nombre\s+es|soy|le\s+habla)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){0,2})/i
  );
  if (m) {
    const name = m[1].trim().replace(/\s+/g, " ");
    // reject "soy de Guadalajara" / "soy cliente" / "soy el que..."
    if (!/^(de|el|la|un|una|cliente|para|que|muy|del|los|las)\b/i.test(name)) return name;
  }
  return null;
}

// A bare reply that is plausibly just a name (used only when we ASKED for it):
// 1–4 letter-words, no digits, no question, none a common non-name word.
// ("Esau", "Eduardo González Pérez" → yes; "Eso entendí", "no gracias" → no)
const _NOT_NAME = new Set([
  "eso", "esa", "ese", "esto", "esta", "este", "gracias", "hola", "si", "no", "ok",
  "okay", "claro", "bueno", "buenas", "listo", "ya", "entendi", "entiendo", "vale",
  "perfecto", "aja", "que", "como", "cuanto", "cuando", "donde", "porque", "pues",
  "ahora", "ahorita", "tal", "vez", "mande", "dime", "ver", "ahi", "aqui",
  // communication / decline / logistics phrases customers send instead of a name
  // (e.g. "sólo mensajes", "mejor por whatsapp", "no tengo teléfono")
  "solo", "solamente", "unicamente", "nomas", "nadamas", "mejor", "prefiero", "quiero",
  "mensaje", "mensajes", "mensajito", "escrito", "texto", "chat", "whatsapp", "wasap",
  "wats", "correo", "email", "mail", "llamada", "llamadas", "llamar", "llame", "llamen",
  "telefono", "numero", "celular", "cel", "contacto", "nada", "nadie", "ninguno",
  "ninguna", "tengo", "puedo", "puede", "puedes", "por", "info", "informacion",
  "precio", "medida", "malla", "sombra", "cotizacion", "cotizar",
]);
function looksLikeBareName(text) {
  const t = String(text || "").trim();
  if (!t || /\d/.test(t) || /[?¿]/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 1 || words.length > 4) return false;
  if (!words.every((w) => /^[A-Za-zÁÉÍÓÚÑáéíóúñ.'-]{2,}$/.test(w))) return false;
  const norm = (w) => w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return !words.some((w) => _NOT_NAME.has(norm(w)));
}

module.exports = { extractPhone, extractName, looksLikeBareName };
