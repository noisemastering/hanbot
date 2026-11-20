// ai/workflow/turnReader.js
//
// THE MODEL READS THE MESSAGE; CODE DECIDES WHAT IS TRUE (2026-11-17).
//
// For a year the engine decided what a customer MEANT with word lists: 154 regex
// tests and 87 early returns in ai/workflow/index.js by the time this was written.
// Each one recognised ONE topic by its vocabulary, claimed the whole turn and
// appended a fixed closing question — so a message carrying three facts got one
// gate's answer and was asked for the other two. The report that ended it
// (wa:5217661038231): "En cuanto me saldria el costo total de un rollo de 2*100 ya
// con IVA y envío a Gutiérrez Zamora Veracruz, CP 93556" → the word "envío" matched,
// and the reply asked him for his código postal and the measure. With that one regex
// switched off, the same message was answered correctly.
//
// This module is the replacement for the READING half only. One model call per turn
// returns everything the message asks and every fact it carries; the gates keep
// their answers (prices, shipping rules, payment rule, addresses — all still code)
// and are now triggered by this verdict instead of by a word.
//
// Contract with the engine:
//   • readTurn() returns a reading, or NULL when the call fails, times out, is
//     switched off, or has no key. NULL means "use the old regex" — every converted
//     site keeps its regex as the fallback, so a model outage degrades to exactly
//     the behaviour that shipped before, never to silence.
//   • A reading is trusted over the regex, both ways: it can claim a turn the word
//     list missed ("elmptecio") and it can stand a gate down that a stray word
//     would have triggered.
//
// Eval: node scripts/turnReaderEval.js   (needs the LLM; ~120 labelled messages)

const { getClient } = require("./llmClient");

// What a message can ASK. One label per question the engine has an answer for;
// "otro" is every other question, so the engine always knows when there is more in
// the message than the gate in front of it can answer.
const ASKS = [
  "precio",            // cuánto cuesta / cotización / costo total (con o sin medida)
  "medidas",           // qué medidas, tamaños o presentaciones hay
  "envio_costo",       // cuánto cuesta el envío, si va incluido, gastos de envío, flete
  "envio_tiempo",      // cuánto tarda en llegar, tiempo de entrega
  "envio_modo",        // si entregan a domicilio, cómo lo mandan, si llegan a su ciudad
  "datos_envio",       // si necesitamos SU domicilio/dirección/datos para enviarle, o dónde los da
  "pago",              // cómo se paga o se compra, formas de pago, tarjeta, transferencia, factura
  "contra_entrega",    // específicamente pago contra entrega / al recibir
  "unidad",            // si se vende por metro cuadrado, metro lineal, por rollo
  "uso_sombra",        // si ESTE producto sirve para dar sombra
  "ubicacion",         // dónde están, dirección, sucursal, tienda física
  "donde_comprar",     // dónde se consigue o se compra el producto
  "recoger",           // quiere pasar a recogerlo o pagarlo en persona
  "ficha_tecnica",     // características técnicas, grosor, gramaje, material, ficha técnica
  "catalogo",          // pide el catálogo o lista de precios
  "colores",           // qué colores hay, o pide un color
  "mas_barato",        // pide algo más económico, descuento, o dice que está caro
  "versiones",         // qué versiones, grosores o tipos hay del producto
  "dimension_producto",// alto, ancho o grosor que TIENE el producto (no la medida a comprar)
  "comparacion_precio",// por qué una medida cuesta más que otra
  "mayoreo",           // mayoreo, distribuidor, revender
  "telefono",          // pide NUESTRO teléfono o contacto
  "impermeable",       // si es impermeable / para lluvia
  "malla_alambre",     // busca malla de alambre, ciclónica, rígida, metálica, para cercar ganado
  "humano",            // pide hablar con una persona
  "otro",              // cualquier otra pregunta o petición
];

// What the message IS, as a whole — independent of any question in it.
const SIGNALS = [
  "saludo",          // trae un saludo
  "info_general",    // pide información en general sin precisar ("quiero más información", "info")
  "aplaza",          // lo va a pensar / checar / consultar / avisa después
  "cortesia",        // da las gracias o se despide
  "espera_oferta",   // espera el Buen Fin, la quincena, el aguinaldo
  "ya_lo_dije",      // reclama que YA nos dio ese dato o ya contestó
  "enojo",           // insulto, hartazgo, "ya párale"
  "queja_atencion",  // se queja de que nadie le contestó o de la atención
  "queja_info",      // se queja de que no le dieron la información o el precio
  "queja_precio",    // se queja de que está caro (como reclamo, no como pregunta)
  "afirma",          // sí / ok / de acuerdo / va
  "niega",           // no / mejor otra cosa
  "ya_compro",       // dice que YA compró o pagó
];

const SYSTEM = `Eres el LECTOR de mensajes de un bot de ventas en México (Hanlob: malla sombra, malla antimaleza/ground cover, borde separador de jardín). NO contestas al cliente. Tu único trabajo es leer UN mensaje y devolver, en JSON, TODO lo que pregunta y TODOS los datos que trae.

Los clientes escriben con faltas de ortografía, sin acentos, con errores de dedo y abreviaturas ("elmptecio" = el precio, "q" = que, "maya" = malla, "cp" = código postal, "ml" = metros lineales, "x"/"*"/"por" entre dos números = una medida). Lee la INTENCIÓN, no las palabras.

Devuelve SOLO este JSON:
{
  "asks": [...],      // TODAS las preguntas o peticiones del mensaje, sin omitir ninguna
  "signals": [...],   // lo que el mensaje ES en conjunto
  "facts": {
    "ancho": número o null,        // ancho en metros de lo que quiere comprar
    "largo": número o null,        // largo en metros de lo que quiere comprar
    "cp": "5 dígitos" o null,      // código postal del cliente
    "ciudad": texto o null,
    "estado": texto o null,
    "colonia": texto o null,
    "area_m2": número o null,      // superficie TOTAL a cubrir, en metros cuadrados
    "sombras": [...],              // porcentajes de sombra que pide, como números (50, 70)
    "cantidad": número o null,     // cuántas PIEZAS o ROLLOS quiere (nunca una medida, nunca un CP)
    "colores": [...],              // colores que nombra
    "nombre": texto o null,        // SOLO si el cliente dice su propio nombre
    "telefono": "10 dígitos" o null,
    "producto": texto o null       // el producto que nombra, con sus palabras
  }
}

VALORES PERMITIDOS EN "asks":
- "precio": cuánto cuesta, costo, cotización, "costo total", "a cómo", "me das el precio" — con o sin medida.
- "medidas": qué medidas, tamaños, anchos, largos o presentaciones manejan.
- "envio_costo": cuánto cuesta el envío, si el envío va incluido ("¿incluye envío?", "¿ya con envío?"), gastos de envío, flete. "costo total ... con envío a <lugar>" pregunta precio Y envio_costo. "¿Incluye envío? Estoy en <ciudad>" es envio_costo (la ciudad es un dato).
- "envio_tiempo": cuánto tarda, cuándo llega, tiempo de entrega.
- "envio_modo": si entregan a domicilio, cómo lo envían, modo de entrega, si mandan a su ciudad o estado.
- "datos_envio": pregunta si necesitamos SU domicilio, dirección o datos para mandarle el pedido, o dónde/cómo nos los da ("¿no ocupan mi domicilio?", "¿a dónde les mando mi dirección?", "¿no me piden mis datos?"). NO es envio_modo: no pregunta si entregamos, pregunta por SUS datos.
- "pago": cómo se paga, cómo se compra, formas de pago, tarjeta, transferencia, meses sin intereses, factura. Vale aunque venga sin signos de interrogación ("los pagos son a contra entrega" ES una pregunta sobre el pago).
- "contra_entrega": pregunta por pago contra entrega / pagar al recibir (pon también "pago").
- "unidad": pregunta si la medida o el precio es por metro CUADRADO o por metro LINEAL ("¿es en cuadrado?", "¿es por metro lineal?"). "¿Se vende por rollo?" / "¿lo venden por metro?" NO es esto: pregunta por las presentaciones → "medidas".
- "uso_sombra": pregunta si ESTE producto (el de la conversación) sirve o funciona para dar sombra. "Quiero sombra para mis vacas" NO lo es: ahí PIDE otro producto (facts.producto = "malla sombra").
- "ubicacion": dónde están, dirección, sucursal, tienda física, de dónde son.
- "donde_comprar": dónde se consigue, dónde lo venden, dónde lo compro.
- "recoger": quiere pasar a recoger o pagar en persona.
- "ficha_tecnica": características, especificaciones, grosor, gramaje, material, resistencia, ficha técnica.
- "catalogo": pide catálogo o lista de precios.
- "colores": qué colores hay, o pide/nombra un color o un tono que quiere ("la quiero en la oscura", "en verde", "la clarita").
- "mas_barato": pide algo más económico, un descuento, o dice que se le hace caro ("está muy caro" → ponlo aquí Y en signals "queja_precio").
- "versiones": qué versiones, tipos, grosores o presentaciones distintas hay del mismo producto.
- "dimension_producto": qué alto, ancho o grosor TIENE el producto (no la medida que quiere comprar).
- "comparacion_precio": por qué una medida cuesta más o menos que otra.
- "mayoreo": mayoreo, ser distribuidor, revender ("quiero revender sus productos"), precio por volumen.
- "telefono": pide NUESTRO número o un contacto para llamar.
- "impermeable": si es impermeable, si sirve para la lluvia.
- "malla_alambre": busca malla de alambre, ciclónica, electrosoldada, gallinero, rígida o metálica, o una cerca para ganado.
- "humano": pide hablar con una persona o asesor.
- "otro": cualquier OTRA pregunta o petición que no esté arriba (garantía, instalación, duración, etc.).

VALORES PERMITIDOS EN "signals":
- "saludo": trae un saludo.
- "info_general": pide información en general sin decir qué: "quiero más información", "quiero obtener más información", "info", "informes", "me interesa". Es el mensaje que escribe el anuncio; márcalo SIEMPRE.
- "aplaza": lo va a pensar, checar, consultar con alguien, o avisa después.
- "cortesia": da las gracias o se despide.
- "espera_oferta": espera el Buen Fin, la quincena, el aguinaldo, fin de mes.
- "ya_lo_dije": reclama que YA nos dio ese dato o que ya contestó ("ya te dije", "ya te la puse arriba").
- "enojo": insulto, hartazgo, "ya párale".
- "queja_atencion": se queja de que nadie le contestó o de la mala atención.
- "queja_info": se queja de que no le dieron la información o el precio.
- "queja_precio": reclama que está muy caro.
- "afirma": sí, ok, claro, de acuerdo, va, dale.
- "niega": no, mejor no, otra cosa ("no gracias" es niega Y cortesia).
- "ya_compro": dice que YA compró o ya pagó.

REGLAS:
1. Un mensaje puede traer VARIAS preguntas: ponlas TODAS. "¿Cuánto cuesta y cuánto tarda el envío?" → ["envio_costo","envio_tiempo"]. Nunca te quedes con una sola.
2. Un dato NO es una pregunta. "CP 93556" es facts.cp, no una pregunta. "2x100" es ancho 2, largo 100.
3. MEDIDAS: en "A x B" el menor suele ser el ancho y el mayor el largo. "rollo de 2*100" → ancho 2, largo 100. "18 metros", "el de 54", "500 ml" son SOLO largo. "de 4 de ancho" es SOLO ancho. Los porcentajes (90%) NO son medidas. Un número de 5 dígitos solo NO es una medida.
3b. ÁREA: una superficie total a cubrir va en area_m2, NO en largo: "200 m2", "cubrir 500 metros cuadrados", "un invernadero de 4 mil metros" (= 4000), "media hectárea" (= 5000), "2 hectáreas" (= 20000). Un terreno, invernadero, huerta o cultivo medido en "metros" sin ancho ni largo es un ÁREA. "18 metros" de borde o "50 metros de largo" es un largo.
3c. SOMBRAS: todos los porcentajes de sombra que pide, cada uno como número: "al 50% y al 70%" → [50, 70]; "uno de 50 y otro de 70" (hablando de sombra) → [50, 70]. Si contesta a nuestra pregunta "¿qué porcentaje?" con "50 y 70", también.
4. CANTIDAD es cuántas piezas o rollos, y SOLO cuando el cliente da un número de piezas: "dos rollos", "3 piezas", "quiero 5". El artículo "una"/"un" ("una de 7x7", "un rollo de 18") NO es una cantidad: null. NUNCA tomes como cantidad una medida, un porcentaje, un CP ni un teléfono. Si dudas, null.
5. CP: 5 dígitos que el cliente da como su código postal, lo etiquete o no ("CP 93556", "mi código es 20900", "soy del 76000"), o cuando contesta a nuestra pregunta por el CP.
6. Usa el ÚLTIMO MENSAJE DEL BOT para entender respuestas cortas: si preguntamos el código postal, "64102" es el cp; si preguntamos cuántos, "3" es cantidad; si preguntamos la medida, "18" es largo; "sí" es "afirma".
7. Nombrar un producto para pedirlo ("ocupo la malla antimaleza", "quiero borde") NO es una pregunta: va en facts.producto. Solo es "precio" si pide precio.
8. Si el mensaje no pregunta ni pide nada, "asks" va vacío.
9. No inventes: si un dato no está en el mensaje, null.`;

const TIMEOUT_MS = 8000;
// gpt-4o: 2026-11-17 exam (scripts/turnReaderEval.js) — gpt-4o-mini 96/109 and it
// missed the plain ones ("Yo lo paso a recoger", "Quiero obtener más información");
// gpt-4o read the same set best and fastest.
const MODEL = process.env.TURN_READER_MODEL || "gpt-4o";

const numOrNull = (v) => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
};
const strOrNull = (v) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && !/^null$/i.test(s) ? s : null;
};

// Shape whatever the model returned into something the engine can rely on: only the
// labels we defined, numbers that are numbers, a CP that is five digits. Anything
// else is dropped — an unknown label must not be able to trigger or block a gate.
function shapeReading(parsed) {
  const p = parsed && typeof parsed === "object" ? parsed : {};
  const asks = new Set((Array.isArray(p.asks) ? p.asks : []).filter((a) => ASKS.includes(a)));
  const signals = new Set((Array.isArray(p.signals) ? p.signals : []).filter((s) => SIGNALS.includes(s)));
  if (asks.has("contra_entrega")) asks.add("pago");
  if (signals.has("queja_precio")) asks.add("mas_barato");
  const f = p.facts && typeof p.facts === "object" ? p.facts : {};
  const cp = String(f.cp == null ? "" : f.cp).replace(/\D/g, "");
  const tel = String(f.telefono == null ? "" : f.telefono).replace(/\D/g, "");
  const facts = {
    ancho: numOrNull(f.ancho),
    largo: numOrNull(f.largo),
    cp: cp.length === 5 ? cp : null,
    ciudad: strOrNull(f.ciudad),
    estado: strOrNull(f.estado),
    colonia: strOrNull(f.colonia),
    area_m2: numOrNull(f.area_m2),
    sombras: [...new Set((Array.isArray(f.sombras) ? f.sombras : []).map((x) => numOrNull(typeof x === "string" ? x.replace("%", "") : x)).filter((n) => n && n <= 100).map((n) => String(Math.round(n))))],
    cantidad: numOrNull(f.cantidad),
    colores: (Array.isArray(f.colores) ? f.colores : []).map(strOrNull).filter(Boolean),
    nombre: strOrNull(f.nombre),
    telefono: tel.length === 10 ? tel : null,
    producto: strOrNull(f.producto),
  };
  // A colour named is a colour asked for ("la oscura", "Verde"): the engine answers
  // both with the real colours and their prices, never by guessing one.
  if (facts.colores.length) asks.add("colores");
  return makeReading({ asks, signals, facts });
}

function makeReading({ asks, signals, facts }) {
  const A = asks instanceof Set ? asks : new Set(asks || []);
  const S = signals instanceof Set ? signals : new Set(signals || []);
  return {
    asks: A,
    signals: S,
    facts: facts || {},
    // Does the message ask this (any of these)?
    asked: (...labels) => labels.some((l) => A.has(l)),
    // Is it this kind of message (any of these)?
    is: (...labels) => labels.some((l) => S.has(l)),
    // Does it ask ANYTHING beyond these labels? This is the question no word list
    // could answer, and the reason a gate used to drop half a message.
    asksBeyond: (...labels) => [...A].some((a) => !labels.includes(a)),
    // Does it ask nothing at all?
    asksNothing: () => A.size === 0,
  };
}

let _offCache = { at: 0, off: false };
async function switchedOff() {
  if (process.env.TURN_READER === "off") return true;
  if (Date.now() - _offCache.at < 15000) return _offCache.off;
  try {
    const s = await require("../../models/SystemState").getState();
    _offCache = { at: Date.now(), off: !!(s && s.turnReaderOff && s.turnReaderOff.engaged) };
  } catch {
    _offCache = { at: Date.now(), off: false };
  }
  return _offCache.off;
}

/**
 * Read one customer message.
 *
 * @param {string} message
 * @param {object} [ctx]
 * @param {string} [ctx.flowName]        the flow serving the conversation
 * @param {string} [ctx.lastBotMessage]  what we said last — short replies are answers to it
 * @returns {Promise<object|null>} a reading, or null → the engine falls back to regex
 */
async function readTurn(message, ctx = {}) {
  const text = String(message || "").trim();
  if (text.length < 1) return null;
  if (!process.env.AI_API_KEY) return null;
  if (await switchedOff()) return null;
  const userContent =
    `PRODUCTO DE ESTA CONVERSACIÓN: ${ctx.flowName || "(sin definir)"}\n` +
    `ÚLTIMO MENSAJE DEL BOT: ${ctx.lastBotMessage ? String(ctx.lastBotMessage).slice(0, 600) : "(ninguno, es el primer mensaje)"}\n` +
    `MENSAJE DEL CLIENTE: ${text.slice(0, 1500)}`;
  try {
    // gpt-5.x are reasoning models: they reject temperature and split the token
    // budget between thinking and the JSON, so they get a larger one (same handling
    // as the scope classifier in tools.js).
    const params = /^gpt-5|^o\d/.test(MODEL)
      ? { model: MODEL, reasoning_effort: process.env.TURN_READER_EFFORT || "low", max_completion_tokens: 2000 }
      : { model: MODEL, temperature: 0, max_tokens: 400 };
    const call = getClient().chat.completions.create({
      ...params,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userContent },
      ],
    });
    const res = await Promise.race([
      call,
      new Promise((_, rej) => setTimeout(() => rej(new Error("turn reader timeout")), TIMEOUT_MS)),
    ]);
    const raw = res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
    if (!raw) return null;
    return shapeReading(JSON.parse(raw));
  } catch (e) {
    console.warn(`⚠️ [turnReader] sin lectura (${e.message}) — el turno usa el respaldo`);
    return null;
  }
}

module.exports = { readTurn, shapeReading, makeReading, ASKS, SIGNALS };
