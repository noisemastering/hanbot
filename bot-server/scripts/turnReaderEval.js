#!/usr/bin/env node
// THE TURN READER'S EXAM — real customer messages, labelled with what they ask and
// the facts they carry. Needs the LLM (one call per case); no DB.
//
// Every message here is one a regex gate got wrong in production, or one whose
// regex reading is load-bearing (so the model must not read it worse). The source
// report is named next to each group — see CLAUDE.md for the full stories.
//
//   node scripts/turnReaderEval.js            # all cases
//   node scripts/turnReaderEval.js --fails    # print only the failures
//   TURN_READER_MODEL=gpt-5.4-mini node scripts/turnReaderEval.js

require("dotenv").config();
const { readTurn } = require("../ai/workflow/turnReader");

const GC = "Ground Cover (Malla Antimaleza)";
const BORDE = "Borde separador - Mayoreo y menudeo";
const REF = "Malla Sombra Confeccionada con Refuerzo — Venta Retail";
const COLD = "Coldstart";

// { m, flow, last?, ask?: [must be asked], notAsk?: [must NOT be asked],
//   is?: [signals], notIs?: [signals], facts?: {k: v}, nothing?: true (asks must be empty) }
const CASES = [
  // ── the report that started this (wa:5217661038231) ─────────────────────────
  { m: "En cuanto me saldria el costo total de un rollo de 2*100 ya con IVA y envío a Gutiérrez Zamora Veracruz, CP 93556", flow: GC,
    ask: ["precio", "envio_costo"], facts: { ancho: 2, largo: 100, cp: "93556" } },
  { m: "Ya te la puse arriba", flow: GC, last: "¿Me compartes tu código postal y la medida que necesitas? 📍", is: ["ya_lo_dije"] },
  { m: "Y quiero malla antimaleza, no malla sombra", flow: GC, notAsk: ["precio", "uso_sombra"] },

  // ── typos the word lists missed ─────────────────────────────────────────────
  { m: "Me das elmptecio de los dos", flow: GC, ask: ["precio"] },
  { m: "Malla Anti malesa", flow: BORDE, notAsk: ["envio_costo", "pago"] },
  { m: "La maya donde sercan alas cabras?", flow: COLD, ask: ["malla_alambre"] },
  { m: "Hola no venden este tipo de Maya?", flow: COLD, notAsk: ["precio"] },
  { m: "cuanto bale la de 4x6", flow: REF, ask: ["precio"], facts: { ancho: 4, largo: 6 } },

  // ── shipping: cost vs time vs how (wa:5217227079986, wa:5219541278285, wa:5217774678321) ──
  { m: "¿Cuál es el costo de envío?", flow: GC, ask: ["envio_costo"], notAsk: ["precio", "envio_tiempo"] },
  { m: "Incluye envío ? Estoy en puerto escondido Oax ?", flow: BORDE, ask: ["envio_costo"] },
  { m: "Gastos de Envío", flow: BORDE, ask: ["envio_costo"] },
  { m: "pregunté si ese precio incluye gastos de envío ?", flow: BORDE, ask: ["envio_costo"] },
  { m: "¿cuánto tarda el envío?", flow: GC, ask: ["envio_tiempo"], notAsk: ["envio_costo"] },
  { m: "Y modo de entrega", flow: BORDE, ask: ["envio_modo"] },
  { m: "Es entrega a domicilio ??", flow: BORDE, ask: ["envio_modo"] },
  { m: "¿cuánto cuesta y en cuánto llega?", flow: BORDE, last: "El rollo de 18 m está en $709", ask: ["envio_tiempo"] },
  { m: "¿cuánto tiempo de garantía tiene?", flow: REF, notAsk: ["envio_tiempo", "envio_costo"], ask: ["otro"] },
  { m: "precio de la malla y costo de envio", flow: COLD, ask: ["precio", "envio_costo"] },
  { m: "hacen envios a tijuana?", flow: REF, ask: ["envio_modo"] },

  // ── payment (wa:5215510160541 and the pago rule) ────────────────────────────
  { m: "Los pagos son a contra entrega", flow: BORDE, ask: ["pago", "contra_entrega"] },
  { m: "¿cómo se compra?", flow: GC, ask: ["pago"] },
  { m: "paga uno al recibir?", flow: REF, ask: ["contra_entrega"] },
  { m: "aceptan tarjeta de credito", flow: REF, ask: ["pago"] },
  { m: "¿Es contra entrega?", flow: GC, ask: ["contra_entrega"], notAsk: ["envio_modo", "envio_costo"] },
  { m: "me pueden facturar?", flow: REF, ask: ["pago"] },

  // ── pickup (psid 28881861821437120) ─────────────────────────────────────────
  { m: "Yo lo paso a recoger y a pagar", flow: BORDE, ask: ["recoger"] },
  { m: "puedo pasar por el a su bodega?", flow: REF, ask: ["recoger"] },

  // ── frustration ─────────────────────────────────────────────────────────────
  { m: "Ya te dije lo que quiero 😀... Tu dijiste la longitud de los rollos", flow: BORDE, is: ["ya_lo_dije"] },
  { m: "Aquí me preguntaste y te respondí", flow: BORDE, is: ["ya_lo_dije"] },
  { m: "También ya te contesté", flow: BORDE, is: ["ya_lo_dije"] },
  { m: "Ya para de mmr", flow: BORDE, is: ["enojo"] },
  { m: "ya te dije que quiero el de 18 m", flow: BORDE, is: ["ya_lo_dije"], facts: { largo: 18 } },

  // ── deferral / courtesy / sale (psid 29251119614512301, wa:5217443178473) ───
  { m: "Voy a chequear", flow: BORDE, is: ["aplaza"], nothing: true },
  { m: "Ya le dije que lo van a checar", flow: BORDE, is: ["aplaza"], nothing: true },
  { m: "Una vez me den respuesta yo le digo", flow: BORDE, is: ["aplaza"], nothing: true },
  { m: "Ok gracias", flow: BORDE, is: ["cortesia"], nothing: true },
  { m: "Muy amable", flow: BORDE, is: ["cortesia"], nothing: true },
  { m: "Solo espero el buen fin", flow: BORDE, is: ["espera_oferta"], nothing: true },
  { m: "voy a checar, pero ¿cuánto el de 18?", flow: BORDE, ask: ["precio"], facts: { largo: 18 } },
  { m: "Gracias, ¿me pasas el link?", flow: REF, notIs: [], ask: ["otro"] },
  { m: "Gracias por tu atención", flow: GC, last: "¿Me compartes un teléfono y tu código postal?", is: ["cortesia"], nothing: true },
  { m: "Gracias,no!!", flow: GC, is: ["cortesia"], nothing: true },

  // ── the unit question (wa:5213324227528) ────────────────────────────────────
  { m: "Esas son las medidas es en cuadrado", flow: BORDE, ask: ["unidad"] },
  { m: "es por metro cuadrado o lineal?", flow: GC, ask: ["unidad"] },
  { m: "el borde se vende por rollo?", flow: BORDE, ask: ["medidas"], notAsk: ["unidad"] },
  { m: "¿hacen envíos a Monterrey?", flow: COLD, ask: ["envio_modo"], notAsk: ["ubicacion"] },
  { m: "Que presio tiene el metro de la oscura", flow: COLD, ask: ["precio", "colores"] },

  // ── where / location (wa:5214443475099) ─────────────────────────────────────
  { m: "donde se consigue?", flow: BORDE, ask: ["donde_comprar"] },
  { m: "donde estan ubicados", flow: REF, ask: ["ubicacion"] },
  { m: "Eras en irapuato", flow: BORDE, ask: ["ubicacion"] },

  // ── colours (wa:5214622537550) ──────────────────────────────────────────────
  { m: "Q colores tienes", flow: BORDE, ask: ["colores"] },
  { m: "Verde", flow: BORDE, last: "El borde separador lo manejamos solo en negro.", ask: ["colores"], facts: { colores: ["verde"] } },
  { m: "la quiero en la oscura", flow: REF, ask: ["colores"] },

  // ── ficha técnica (psid 28508399788837176) ──────────────────────────────────
  { m: "Quiero características de ese ground cover . Grosor", flow: GC, ask: ["ficha_tecnica"] },
  { m: "precio por rollo y ficha técnica", flow: GC, ask: ["precio", "ficha_tecnica"] },
  { m: "¿cuál es el gramaje del rollo de 2x100?", flow: GC, ask: ["ficha_tecnica"], facts: { ancho: 2, largo: 100 } },

  // ── catalog / wholesale ─────────────────────────────────────────────────────
  { m: "algo asi como un catalogo con su precios para poder comenzar a ver opciones", flow: COLD, ask: ["catalogo"] },
  { m: "Información para ser distribuidor", flow: COLD, ask: ["mayoreo"] },
  { m: "quiero revender sus productos", flow: COLD, ask: ["mayoreo"] },
  { m: "solo quiero una para mi casa", flow: COLD, notAsk: ["mayoreo"] },

  // ── price / sizes / opener ──────────────────────────────────────────────────
  { m: "¡Hola! Quiero más información", flow: BORDE, is: ["saludo", "info_general"], notAsk: ["envio_costo", "pago"] },
  { m: "Quiero obtener más información.", flow: BORDE, is: ["info_general"] },
  { m: "Precio por favor", flow: BORDE, ask: ["precio"] },
  { m: "¿cuál es el precio de la malla?", flow: COLD, ask: ["precio"] },
  { m: "Medidas de la mallas", flow: GC, ask: ["medidas"], notAsk: ["catalogo"] },
  { m: "Que medidas tiene y precio?", flow: GC, ask: ["medidas", "precio"] },
  { m: "¿qué precio tienen los rollos?", flow: GC, ask: ["precio"] },
  { m: "Gracias, quiero cotizar 10 metros", flow: GC, ask: ["precio"], facts: { largo: 10 } },
  { m: "Precio del rollo", flow: GC, ask: ["precio"] },
  { m: "Costo de La malla sombra", flow: COLD, ask: ["precio"] },
  { m: "Hola", flow: REF, is: ["saludo"], nothing: true },
  { m: "Buenos días", flow: COLD, is: ["saludo"], nothing: true },

  // ── cheaper / versions / comparison (Alejandra Mora; 6x4 vs 5x4) ────────────
  { m: "no tiene algo mas economico?", flow: BORDE, ask: ["mas_barato"] },
  { m: "que versiones manejan", flow: BORDE, ask: ["versiones"] },
  { m: "¿Por qué es más cara la de 6x4 que la de 5x4?", flow: REF, ask: ["comparacion_precio"] },
  { m: "esta muy caro", flow: GC, ask: ["mas_barato"] },

  // ── complaints (§5C) ────────────────────────────────────────────────────────
  { m: "nadie me contesto y ya llevo dos dias esperando", flow: GC, is: ["queja_atencion"] },
  { m: "Pedí el precio y nadie me lo proporciono", flow: GC, is: ["queja_info"] },
  { m: "nunca me dijeron el precio", flow: GC, is: ["queja_info"] },

  // ── does it give shade (psid 29285635167791094) ─────────────────────────────
  { m: "esta malla tambien sirve de sombra para mis plantas?", flow: GC, ask: ["uso_sombra"] },
  { m: "quiero sombra para mis vacas", flow: GC, notAsk: ["uso_sombra"] },

  // ── facts: measures, lengths, quantities, CPs ──────────────────────────────
  { m: "18 mts. C P 92730", flow: BORDE, facts: { largo: 18, cp: "92730" } },
  { m: "500 ml aprox precio", flow: BORDE, ask: ["precio"], facts: { largo: 500 } },
  { m: "Total aprox 500 m", flow: BORDE, facts: { largo: 500 } },
  { m: "2 x100", flow: GC, facts: { ancho: 2, largo: 100 } },
  { m: "3 × 4", flow: GC, facts: { ancho: 3, largo: 4 } },
  { m: "la de cuatro por cien", flow: GC, facts: { ancho: 4, largo: 100 } },
  { m: "6.20 x 18 m confeccionada al 90%, en una sola pieza", flow: REF, facts: { ancho: 6.2, largo: 18 } },
  { m: "quiero 2 rollos de 54", flow: BORDE, facts: { cantidad: 2, largo: 54 } },
  { m: "las dos versiones", flow: BORDE, last: "¿Te interesa el grueso o el flexible?", facts: { cantidad: null } },
  { m: "64102", flow: GC, last: "¿Me compartes tu código postal? 📍", facts: { cp: "64102", cantidad: null, largo: null } },
  { m: "es el 50000", flow: GC, last: "¿Me compartes tu código postal? 📍", facts: { cp: "50000" } },
  { m: "CP 76000, colonia Centro", flow: GC, facts: { cp: "76000", colonia: "Centro" } },
  { m: "3", flow: BORDE, last: "¿Cuántos rollos de 18 m necesitas? 😊", facts: { cantidad: 3 } },
  { m: "El de 18", flow: BORDE, last: "¿Cuál te sirve? 6 m, 9 m, 18 m o 54 m", facts: { largo: 18, cantidad: null } },
  { m: "5 metros cuadrados", flow: BORDE, facts: { cantidad: null } },
  // ── area and shades as facts (2026-11-18, psids 9297864033594328 / 9502472699867645)
  { m: "para un invernadero de 4 mil metros", flow: GC, facts: { area_m2: 4000, largo: null, cantidad: null } },
  { m: "Necesito cubrir 200 m2", flow: GC, facts: { area_m2: 200 } },
  { m: "es para media hectarea", flow: GC, facts: { area_m2: 5000 } },
  { m: "de 4 metros de ancho", flow: GC, last: "¿Lo quieres en rollo de 2 m o de 4 m de ancho?", facts: { ancho: 4, area_m2: null } },
  { m: "De 50% y 70%", flow: "Malla Sombra — Rollo", last: "Ese rollo de 4 x 100 m lo manejamos en varios porcentajes de sombra (35%, 50%, 70%, 80%, 90%). ¿Cuál necesitas?", facts: { sombras: ["50", "70"], cantidad: null } },
  { m: "Solo necesito 2 rollos, del mismo tamaño, uno al 50% y el otro al 70% de sombra de Rachel", flow: "Malla Sombra — Rollo", facts: { sombras: ["50", "70"], cantidad: 2 } },
  { m: "Medidas de 4 m por 100 de largo de ambos rollos\n4.2 x100 ambos", flow: "Malla Sombra — Rollo", facts: { largo: 100 } },
  { m: "me llamo Maria Celia Fajardo jimenez", flow: REF, facts: { nombre: "Maria Celia Fajardo jimenez" } },
  { m: "mi numero es 4421234567", flow: REF, facts: { telefono: "4421234567" } },
  { m: "una de 7x7 al 90%", flow: REF, facts: { ancho: 7, largo: 7, cantidad: null } },

  // ── confirmations ───────────────────────────────────────────────────────────
  { m: "Si", flow: GC, last: "¿el área que buscas cubrir es de 200 m², correcto?", is: ["afirma"], nothing: true },
  { m: "Ok", flow: REF, last: "¿Te comparto el link de compra?", is: ["afirma"] },
  { m: "sí claro", flow: BORDE, last: "¿Te lo dejamos preparado?", is: ["afirma"] },
  { m: "no gracias", flow: REF, last: "¿Te comparto el link?", is: ["niega"] },

  // ── other products named on a flow (2026-11-02) ─────────────────────────────
  { m: "quiero borde plastico , pero tengo un vivero dame precio", flow: GC, ask: ["precio"] },
  { m: "Ocupo la malla antimaleza", flow: GC, notAsk: ["precio", "envio_costo"] },
  { m: "En su catálogo si viene ?", flow: GC, last: "Te comparto nuestro catálogo 📄", notAsk: ["precio", "envio_costo"] },

  // ── misc that must NOT trigger the money gates ──────────────────────────────
  { m: "ya compre una la semana pasada", flow: REF, is: ["ya_compro"] },
  { m: "es impermeable?", flow: REF, ask: ["impermeable"] },
  { m: "me pasas un numero para llamar", flow: REF, ask: ["telefono"] },
  { m: "quiero hablar con una persona", flow: REF, ask: ["humano"] },
  { m: "que alto tiene el borde?", flow: BORDE, ask: ["dimension_producto"] },
  { m: "cuanto dura la malla al sol", flow: REF, ask: ["otro"], notAsk: ["envio_tiempo", "precio"] },
];

const eq = (a, b) => {
  if (b === null) return a === null || a === undefined || (Array.isArray(a) && a.length === 0);
  if (Array.isArray(b)) return Array.isArray(a) && b.every((x) => a.map((y) => String(y).toLowerCase()).includes(String(x).toLowerCase()));
  if (typeof b === "number") return Number(a) === b;
  return String(a || "").toLowerCase() === String(b).toLowerCase();
};

(async () => {
  const onlyFails = process.argv.includes("--fails");
  let pass = 0;
  const fails = [];
  const started = Date.now();
  // small concurrency so the exam takes seconds, not minutes
  const queue = CASES.map((c, i) => ({ c, i }));
  const results = new Array(CASES.length);
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (queue.length) {
        const { c, i } = queue.shift();
        results[i] = await readTurn(c.m, { flowName: c.flow, lastBotMessage: c.last || null });
      }
    })
  );
  CASES.forEach((c, i) => {
    const r = results[i];
    const why = [];
    if (!r) why.push("NO READING (call failed)");
    else {
      for (const a of c.ask || []) if (!r.asks.has(a)) why.push(`missing ask "${a}"`);
      for (const a of c.notAsk || []) if (r.asks.has(a)) why.push(`unexpected ask "${a}"`);
      for (const s of c.is || []) if (!r.signals.has(s)) why.push(`missing signal "${s}"`);
      for (const s of c.notIs || []) if (r.signals.has(s)) why.push(`unexpected signal "${s}"`);
      if (c.nothing && r.asks.size) why.push(`should ask nothing, got [${[...r.asks]}]`);
      // ancho/largo may come back swapped for a square or "A x B" — the engine sorts them
      const f = { ...(c.facts || {}) };
      if (f.ancho != null && f.largo != null) {
        const got = [r.facts.ancho, r.facts.largo].map(Number).sort((a, b) => a - b).join("x");
        const want = [f.ancho, f.largo].sort((a, b) => a - b).join("x");
        if (got !== want) why.push(`medida: want ${want}, got ${got}`);
        delete f.ancho; delete f.largo;
      }
      for (const [k, v] of Object.entries(f)) if (!eq(r.facts[k], v)) why.push(`facts.${k}: want ${JSON.stringify(v)}, got ${JSON.stringify(r.facts[k])}`);
    }
    if (why.length) fails.push({ c, r, why });
    else pass++;
    if (!onlyFails && !why.length) console.log(`✅ ${c.m.slice(0, 70)}`);
  });
  for (const f of fails) {
    console.log(`\n❌ ${f.c.m}\n   ${f.why.join("; ")}`);
    if (f.r) console.log(`   got: asks=[${[...f.r.asks]}] signals=[${[...f.r.signals]}] facts=${JSON.stringify(Object.fromEntries(Object.entries(f.r.facts).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length))))}`);
  }
  console.log(`\nturnReader (${process.env.TURN_READER_MODEL || "gpt-4o"}) — ${pass}/${CASES.length} passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  process.exit(fails.length ? 1 : 0);
})();
