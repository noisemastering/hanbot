// utils/quoteSuggest.js
//
// THE PREFILL. When an asesor marks a conversation as quoted, the form opens
// with what the conversation was about already filled in — the model reads the
// visit and picks the products from OUR catalogue. The asesor confirms; nothing
// is saved from here.
//
// The model is never trusted on its own (same contract as gcReasonClusters):
//   - a product code that is not in the list we sent is DROPPED;
//   - a quantity that is not a positive whole number becomes 1;
//   - a product the customer wants that we do not list (a sobre-medida piece)
//     comes back as free text, and stays free text — it is never forced onto
//     the nearest catalogue entry.
// A failed call returns nothing from the model and the form still opens with
// the links that were actually sent in that visit (ClickLog), which is a fact.
const ProductFamily = require("../models/ProductFamily");

const MODEL = process.env.QUOTE_SUGGEST_MODEL || "gpt-4o";
const TIMEOUT_MS = 20000;

let _client = null;
function getClient() {
  if (!_client) {
    const { OpenAI } = require("openai");
    _client = new OpenAI({ apiKey: process.env.AI_API_KEY });
  }
  return _client;
}

let _cat = null, _catAt = 0;
// Every sellable leaf with a readable full name ("Malla Sombra Raschel > 90% > … > Color Beige").
async function loadCatalog() {
  if (_cat && Date.now() - _catAt < 5 * 60 * 1000) return _cat;
  const all = await ProductFamily.find({}).select("name parentId sellable active productCode size").lean();
  const by = new Map(all.map((p) => [String(p._id), p]));
  const pathOf = (p) => {
    const out = [];
    let c = p, guard = 0;
    while (c && guard++ < 12) { out.unshift(c.name); c = c.parentId ? by.get(String(c.parentId)) : null; }
    return out.join(" > ");
  };
  _cat = all
    .filter((p) => p.sellable)
    .map((p) => ({
      productId: String(p._id),
      productCode: p.productCode || null,
      label: pathOf(p),
      size: p.size || null,
      active: p.active !== false,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
  _catAt = Date.now();
  return _cat;
}

const SYSTEM = `Eres el asistente del equipo de ventas de Hanlob (malla sombra, malla antimaleza / ground cover, borde separador y complementos).
Vas a leer UNA conversación entre un cliente y Hanlob, y a decir qué productos habría que COTIZARLE: lo que el cliente pidió o lo que se le terminó ofreciendo y aceptó.

Reglas:
- Elige los productos SOLO del CATÁLOGO que se te da, por su CÓDIGO exacto.
- Si el cliente quiere algo que NO está en el catálogo (una medida a la medida, por ejemplo 6.20 x 18 m), NO lo acerques a otra medida: ponlo en "libres" con una descripción corta y clara.
- La cantidad es la que dijo el cliente; si no dijo ninguna, es 1.
- Si no dijo color y el producto existe en varios, elige el que se le cotizó; si no se le cotizó ninguno, el beige en malla confeccionada y el negro en lo demás.
- No incluyas productos que solo se mencionaron de paso o que el cliente rechazó.
- "tema" es una frase de máximo 6 palabras que diga de qué trató la conversación (ej. "Rollo antimaleza 4x100").
- Si la conversación no trata de ningún producto, devuelve las listas vacías.

Responde SOLO con JSON: {"tema": "...", "items": [{"codigo": "...", "cantidad": 1}], "libres": [{"descripcion": "...", "cantidad": 1}]}`;

const posInt = (n) => (Number.isFinite(Number(n)) && Number(n) >= 1 ? Math.min(Math.round(Number(n)), 100000) : 1);

// Pure: turns whatever the model said into items we can stand behind.
function shapeSuggestion(raw, catalog) {
  const byCode = new Map(catalog.filter((c) => c.productCode).map((c) => [c.productCode, c]));
  const items = [];
  const seen = new Set();
  for (const it of Array.isArray(raw && raw.items) ? raw.items : []) {
    const c = byCode.get(String((it && it.codigo) || "").trim().toUpperCase());
    if (!c || seen.has(c.productId)) continue;
    seen.add(c.productId);
    items.push({ productId: c.productId, productCode: c.productCode, label: c.label, qty: posInt(it.cantidad), source: "bot" });
  }
  for (const it of Array.isArray(raw && raw.libres) ? raw.libres : []) {
    const label = String((it && it.descripcion) || "").trim().slice(0, 160);
    if (label.length < 3) continue;
    items.push({ productId: null, productCode: null, label, qty: posInt(it.cantidad), source: "bot" });
  }
  const topic = typeof (raw && raw.tema) === "string" ? raw.tema.trim().slice(0, 60) : null;
  return { topic: topic || null, items };
}

/**
 * @param {Array} messages  the visit's messages, oldest first
 * @param {Array<string>} sentProductIds  products whose link went out in that visit
 */
async function suggestItems(messages, sentProductIds = []) {
  const catalog = await loadCatalog();
  let shaped = { topic: null, items: [] };
  let readByModel = false;
  const transcript = (messages || [])
    .filter((m) => m.text)
    .slice(-80)
    .map((m) => `${m.senderType === "user" ? "CLIENTE" : m.senderType === "human" ? "ASESOR" : "BOT"}: ${String(m.text).slice(0, 500)}`)
    .join("\n");
  if (transcript && process.env.AI_API_KEY) {
    try {
      const catText = catalog.filter((c) => c.productCode).map((c) => `${c.productCode} | ${c.label}`).join("\n");
      const call = getClient().chat.completions.create({
        model: MODEL,
        temperature: 0,
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `CATÁLOGO (código | producto):\n${catText}\n\nCONVERSACIÓN:\n${transcript}` },
        ],
      });
      const res = await Promise.race([
        call,
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS)),
      ]);
      shaped = shapeSuggestion(JSON.parse(res.choices[0].message.content), catalog);
      readByModel = true;
    } catch (e) {
      console.warn(`⚠️ [quoteSuggest] sin lectura del modelo (${e.message})`);
    }
  }
  // Only when the model gave us nothing: the links that really went out are a fact.
  if (!shaped.items.length && sentProductIds.length) {
    const byId = new Map(catalog.map((c) => [c.productId, c]));
    for (const id of [...new Set(sentProductIds.map(String))]) {
      const c = byId.get(id);
      if (c) shaped.items.push({ productId: c.productId, productCode: c.productCode, label: c.label, qty: 1, source: "bot" });
    }
  }
  return { ...shaped, readByModel };
}

module.exports = { loadCatalog, suggestItems, shapeSuggestion };
