// scripts/scenarioBattery.js
//
// Reusable SCENARIO BATTERY for the workflow engine. Unlike convoAudit (which
// grades real historical traffic), this runs a fixed set of SYNTHETIC scenarios
// through the live engine and grades each with an LLM judge — so it's repeatable
// and not dependent on real conversations.
//
// RELEVANCE-MAPPED (not a 57×flow matrix, not a blind carousel):
//   - ENGINE-shared behaviors run ONCE on a representative flow.
//   - FLOW-specific behaviors run on THEIR flow only.
// Each case is tagged with the flow it runs on, so coverage is real.
//
// Usage:
//   node scripts/scenarioBattery.js                 # run all, judge each
//   node scripts/scenarioBattery.js --flow=Coldstart
//   node scripts/scenarioBattery.js --group=coldstart
//   node scripts/scenarioBattery.js --smoke         # 1 case (harness check)
//   node scripts/scenarioBattery.js --no-judge      # run only, print transcripts
//
// Add the client's new flow by appending its cases to CASES (group: 'newflow').

const mongoose = require("mongoose");
require("dotenv").config();
const { OpenAI } = require("openai");
const WF = require("../models/Workflow");
// Register the models setupContext resolves lazily via mongoose.model(...) — without
// these the promo/preload context silently degrades (falls back to a generic line).
require("../models/ProductFamily");
require("../models/Product");
require("../models/Promo");
const { runWorkflowTurn, initState } = require("../ai/workflow");

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });
const PROMO_6X4 = "69cdbaf4e85f61fda9122664"; // active "Promo 6x4 Beige" (reforzada ad preload)

// Flow name matchers (substring, case-insensitive) → resolved to the active doc.
const FLOWS = {
  reforzada: /con Refuerzo.*Retail/i,
  rollo: /Malla Sombra — Rollo/i,
  groundcover: /Ground Cover/i,
  sinrefuerzo: /Sin Refuerzo/i,
  borde: /Borde separador/i,
  complementos: /Complementos de Instalaci/i,
  coldstart: /Coldstart/i,
};

// ── CASES ────────────────────────────────────────────────────────────────────
// { id, group, flow, setup?, turns[], expect }  (expect = what a correct bot does)
const CASES = [
  // ENGINE-SHARED (run once, on reforzada as representative) ───────────────────
  // NOTE: CP CAPTURE (both unprompted bare "77539" and "mi cp es 45100" after we
  // asked) is an OUTER-LAYER deterministic behavior — ai/index.js runEngineWorkflow:
  // captureZipReply + a ZipCode-DB validation (a bare 5-digit is treated as a CP
  // ONLY if it's a real Mexican code) + syncLocationToUser. It is NOT reachable via
  // runWorkflowTurn, so it's verified separately (ZipCode lookup tests), not by this
  // engine-level battery — where the model alone handles a lone number inconsistently.
  { id: "eng-promo-no-repitch", group: "engine", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["hola", "quiero la de 6x3", "excelente, gracias"],
    expect: "Tras la primera respuesta, el bot NO vuelve a re-ofrecer la promoción 6x4 en cada turno; en 'excelente' no re-pitchea la promo." },
  { id: "eng-collect-before-handoff", group: "engine", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["quiero una malla a la medida exacta de 12x12 con instalación"],
    expect: "Si escala a un asesor, pide nombre y teléfono (o afirma sobre-medida y ofrece asesor); NUNCA cotiza una 6x4 fija como si fuera lo pedido." },
  { id: "eng-multimeasure-wxl", group: "engine", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["me cotizas 6x3 y 6x5?"],
    expect: "Cotiza AMBAS medidas con su propio precio y link. NOTA: los lados se normalizan (6x5 puede mostrarse como 5x6 — es la MISMA medida, NO cuenta como error)." },
  { id: "eng-live-ml-price", group: "engine", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["cuánto la de 6x4?"],
    expect: "Da un precio concreto de la 6x4 junto con su link de Mercado Libre (no se queda sin cotizar). El precio en vivo correcto ronda $699." },
  { id: "eng-already-bought", group: "engine", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["ya la compré, gracias"],
    expect: "Reconoce la compra; NO re-pitchea la promo ni re-comparte un link de compra." },
  { id: "eng-impermeable", group: "engine", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["esta malla me protege de la lluvia?"],
    expect: "Aclara que la malla sombra NO es impermeable / deja pasar el agua; no la vende como impermeable." },

  // REFORZADA ───────────────────────────────────────────────────────────────
  { id: "ref-non-promo-measure", group: "reforzada", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["quiero la de 6x3"],
    expect: "Cotiza 6x3 con SU precio/link; NO devuelve la 6x4 de la promo." },
  { id: "ref-custom-size", group: "reforzada", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["tienes de 1x5?"],
    expect: "Afirma que se puede sobre medida y/o ofrece la medida estándar más cercana; NUNCA niega tajante." },
  { id: "ref-color", group: "reforzada", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["la tienes en negro?"],
    expect: "El cliente pide un color específico (negro): lo OFRECE con su precio y su link propio (negro y verde SÍ están en stock). NUNCA responde 'solo beige' ni escala a un asesor por un color que está en stock." },
  { id: "ref-color-first-msg", group: "reforzada", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["la tienes en color verde"],
    expect: "AUNQUE sea el PRIMER mensaje (sin haber cotizado antes), OFRECE la 6x4 en VERDE con su precio y link. NUNCA escala a un asesor ni pide nombre/teléfono por un color que está en stock." },
  { id: "ref-quantity-retail", group: "reforzada", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["quiero 3 piezas de 6x4"],
    expect: "3 piezas está por DEBAJO del mínimo de mayoreo (5 para 6x4) → es MENUDEO: cotiza el precio por pieza con su link; NO lo trata como mayoreo." },
  { id: "ref-quantity-wholesale", group: "reforzada", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["quiero 6 piezas de 6x4"],
    expect: "6 piezas alcanza el mínimo de mayoreo (5 para 6x4) → reconoce que es MAYOREO/volumen y pide NOMBRE y TELÉFONO para pasar con un asesor." },
  { id: "ref-measure-label", group: "reforzada", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["cuánto la de 8x4?"],
    expect: "Cotiza la medida 8x4 (= 4x8 m, sí existe en catálogo) con su precio (~$989) y link. La MEDIDA que menciona debe ser 8x4 o 4x8 (mismo producto) — NUNCA otra como 7x4 (fue un bug real reportado por el cliente)." },

  // ROLLO ─────────────────────────────────────────────────────────────────────
  { id: "rollo-ask-length-area", group: "rollo", flow: "rollo",
    turns: ["me interesa la malla en rollo"],
    expect: "Pregunta qué LARGO necesita o qué ÁREA cubrir; NO enumera todas las medidas ni da un rango sin sentido." },
  { id: "rollo-exact-ask-qty", group: "rollo", flow: "rollo",
    turns: ["quiero 90% de 4x50"],
    expect: "Identifica el rollo 90% 4x50 y pregunta SOLO la cantidad (cuántos rollos)." },
  { id: "rollo-qty-2plus", group: "rollo", flow: "rollo",
    turns: ["quiero 90% de 4x50", "necesito 3"],
    expect: "3 rollos = MAYOREO → pasa con un especialista." },
  { id: "rollo-unavailable-shade", group: "rollo", flow: "rollo",
    turns: ["tienes rollos de 75%?"],
    expect: "No manejamos 75% → lo dice y lo pasa con un especialista, preguntando a qué le quiere dar sombra." },
  { id: "rollo-nonexact-area", group: "rollo", flow: "rollo",
    turns: ["tienes rollo de 5x20 en 90%?", "sí, correcto"],
    expect: "Confirma el área (~100 m²) y recomienda un rollo real cuya ÁREA se acerque a 100 m² (p. ej. 2x50 = 100 m² es CORRECTO), con precio + link." },
  { id: "rollo-no-confeccionada-switch", group: "rollo", flow: "rollo",
    turns: ["quiero 90% de 2x10"],
    expect: "Cotiza el ROLLO 2x10; NO cambia a confeccionada ni pregunta '¿reforzada o rollo?'." },

  // GROUND COVER ──────────────────────────────────────────────────────────────
  { id: "gc-ask-length-no-shade", group: "groundcover", flow: "groundcover",
    turns: ["me interesa ground cover"],
    expect: "Pregunta largo o área; NUNCA pregunta por % de sombra (ground cover no tiene)." },
  { id: "gc-exact-qty", group: "groundcover", flow: "groundcover",
    turns: ["quiero ground cover de 4x100", "1"],
    expect: "Cotiza 4x100 y con cantidad 1 comparte precio+link." },
  { id: "gc-alias-antimaleza", group: "groundcover", flow: "groundcover",
    turns: ["tienen malla antimaleza?"],
    expect: "Reconoce 'antimaleza' como ground cover y ayuda; no dice que no lo manejan." },
  { id: "gc-no-confeccionada-switch", group: "groundcover", flow: "groundcover",
    turns: ["tienes de 4x10?"],
    expect: "Trata 4x10 como ground cover (confirma área o cotiza); NO cambia a malla sombra confeccionada." },

  // BORDE ─────────────────────────────────────────────────────────────────────
  { id: "borde-por-rollo", group: "borde", flow: "borde",
    turns: ["el borde se vende por rollo?"],
    expect: "Confirma que sí se vende por rollo/largo y menciona los largos disponibles (6, 9, 18, 54 m); no escala lo que puede contestar." },
  { id: "borde-single", group: "borde", flow: "borde",
    turns: ["precio del borde de 18 m"],
    expect: "Da el precio del borde 18 m (grueso por defecto) y PREGUNTA cuántos rollos necesita ANTES de compartir el link (no comparte link todavía)." },
  { id: "borde-qty-one", group: "borde", flow: "borde",
    turns: ["precio del borde", "de 54", "uno"],
    expect: "Tras pedir el largo pregunta cuántos rollos; al responder 1, cotiza el rollo de 54 m con su precio Y el link de compra." },
  { id: "borde-qty-mayoreo", group: "borde", flow: "borde",
    turns: ["precio del borde", "de 54", "dos"],
    expect: "Al pedir 2 rollos lo trata como MAYOREO y pasa con un especialista (no comparte link de menudeo)." },
  { id: "borde-multi-length", group: "borde", flow: "borde",
    turns: ["precio del borde de 9 y 18 m"],
    expect: "Cotiza AMBOS largos (9 m y 18 m), cada uno con su precio y link." },
  { id: "borde-delgado", group: "borde", flow: "borde",
    turns: ["quiero el borde delgado de 18 m"],
    expect: "Reconoce la variante DELGADO de 18 m (no el grueso), da su precio y PREGUNTA cuántos rollos antes de compartir el link." },
  { id: "borde-closest", group: "borde", flow: "borde",
    turns: ["quiero 57 metros de borde"],
    expect: "Ofrece el largo disponible más cercano (54 m); no niega ni inventa." },
  { id: "borde-switch-antimaleza", group: "borde", flow: "borde",
    turns: ["precio de la malla antimaleza"],
    expect: "Reconoce que antimaleza es GROUND COVER (otro flujo) y ayuda con ese producto (pregunta largo/área o cotiza); NUNCA responde con el borde separador ni '¿qué largo?' de borde." },
  { id: "borde-switch-malla-rollo", group: "borde", flow: "borde",
    turns: ["quiero malla sombra en rollo de 4.2 x 100 al 35%"],
    expect: "Cambia al flujo de MALLA SOMBRA ROLLO y cotiza/ayuda con ese rollo; NUNCA lo trata como borde separador." },

  // SIN REFUERZO ──────────────────────────────────────────────────────────────
  { id: "sin-beige-only", group: "sinrefuerzo", flow: "sinrefuerzo",
    turns: ["la de argollas de 3x3 en negro"],
    expect: "Aclara que sin refuerzo (con argollas) es SOLO beige; no ofrece negro." },
  { id: "sin-in-catalog", group: "sinrefuerzo", flow: "sinrefuerzo",
    turns: ["precio de la de argollas 3x3"],
    expect: "Cotiza la 3x3 CON ARGOLLAS en beige con precio/link. NOTA: 'con argollas' = 'sin refuerzo' (es el MISMO producto); cotizar 'la de argollas' es CORRECTO." },
  { id: "sin-missing-mention-reforzada", group: "sinrefuerzo", flow: "sinrefuerzo",
    turns: ["tienes con argollas de 7x10?"],
    expect: "Esa medida no está en sin refuerzo → MENCIONA que en REFORZADA sí, con su precio+link; NO cambia de flujo." },

  // COMPLEMENTOS DE INSTALACIÓN ────────────────────────────────────────────────
  // Named SKUs (kit / cordón / ojillos packets), resolved deterministically; the
  // net→complement map: confeccionada→kit+cordón, rollo/GC→ojillos+cordón.
  { id: "comp-kit-direct", group: "complementos", flow: "complementos",
    turns: ["cuánto cuesta el kit de instalación?"],
    expect: "Cotiza el kit de instalación con un precio en vivo y su link de compra; NUNCA dice que no tiene el precio ni pide una medida." },
  { id: "comp-cordon", group: "complementos", flow: "complementos",
    turns: ["me das precio del cordón con protección uv?"],
    expect: "Cotiza el cordón/lazo con protección UV (rollo de 47 m) con precio + link." },
  { id: "comp-ojillos-count", group: "complementos", flow: "complementos",
    turns: ["necesito como 45 ojillos sujetadores, precio?"],
    expect: "Para 45 ojillos ofrece el PAQUETE inmediato superior (50 piezas) con precio + link; no inventa ni pide una medida." },
  { id: "comp-ojillos-askqty", group: "complementos", flow: "complementos",
    turns: ["quiero ojillos sujetadores", "como 80"],
    expect: "Primero pregunta cuántas piezas necesita (paquetes 10–100); con 80 cotiza el paquete de 100 con precio + link." },
  { id: "comp-net-confeccionada", group: "complementos", flow: "complementos",
    turns: ["tengo malla confeccionada, qué necesito para instalarla?"],
    expect: "Recomienda el KIT de instalación + el CORDÓN UV (no ojillos); puede ofrecer cotizar alguno." },
  { id: "comp-net-rollo", group: "complementos", flow: "complementos",
    turns: ["tengo un rollo de malla sombra, con qué lo monto?"],
    expect: "Recomienda los OJILLOS SUJETADORES + el CORDÓN UV (no el kit)." },

  // ── COLD-START (special focus — biggest concern) ─────────────────────────────
  { id: "cs-bare-measure", group: "coldstart", flow: "coldstart",
    turns: ["precio de 3x3"],
    expect: "Una medida 2-D pelona (3x3) debe enrutar a MALLA CONFECCIONADA (reforzada, el default) y cotizar 3x3; NUNCA tratarla como borde/rollo 1-D, ni quedarse mudo." },
  { id: "cs-100m-to-rollo", group: "coldstart", flow: "coldstart",
    turns: ["quiero malla de 4x100"],
    expect: "4x100 existe en ROLLO y en GROUND COVER → enruta a uno de ellos, o aclara entre rollo y ground cover; NUNCA confeccionada/reforzada/borde. (Aclarar entre rollo y GC es válido.)" },
  { id: "cs-confeccionada", group: "coldstart", flow: "coldstart",
    turns: ["malla sombra confeccionada de 4x6"],
    expect: "Enruta a malla sombra confeccionada (reforzada)." },
  { id: "cs-ground-cover", group: "coldstart", flow: "coldstart",
    turns: ["tienen ground cover?"],
    expect: "Reconoce ground cover y enruta a su flujo; no lo confunde con malla sombra." },
  { id: "cs-antimaleza", group: "coldstart", flow: "coldstart",
    turns: ["busco malla antimaleza para el suelo"],
    expect: "Reconoce 'antimaleza' = ground cover y enruta allí." },
  { id: "cs-borde", group: "coldstart", flow: "coldstart",
    turns: ["necesito borde separador para jardín"],
    expect: "Enruta al flujo de borde separador." },
  { id: "cs-argollas", group: "coldstart", flow: "coldstart",
    turns: ["quiero la malla con argollas, sin refuerzo"],
    expect: "Enruta a sin refuerzo (con argollas)." },
  { id: "cs-rain", group: "coldstart", flow: "coldstart",
    turns: ["necesito algo para que no entre la lluvia al patio"],
    expect: "Aclara que la malla sombra NO es impermeable; no la vende como protección de lluvia. Ofrece lo que sí aplica o asesor." },
  { id: "cs-greeting-only", group: "coldstart", flow: "coldstart",
    turns: ["hola, buenas"],
    expect: "Saluda e identifica qué producto/medida busca; NO vuelca una lista larga de medidas ni inventa." },
  { id: "cs-out-of-realm", group: "coldstart", flow: "coldstart",
    turns: ["venden tinacos?"],
    expect: "Aclara con naturalidad que no manejamos ese producto; no inventa ni cotiza algo que no vendemos." },
  { id: "cs-measure-plus-product", group: "coldstart", flow: "coldstart",
    turns: ["un rollo de 2x100 de malla sombra"],
    expect: "Enruta a ROLLO con esa medida." },
  { id: "cs-malla-6x4", group: "coldstart", flow: "coldstart",
    turns: ["dame el precio de la malla 6x4"],
    expect: "Enruta a malla confeccionada (reforzada) y cotiza 6x4 con su precio LIVE de ML + link; el precio sale del flujo correcto, no inventado." },
  { id: "cs-worded-measure", group: "coldstart", flow: "coldstart",
    turns: ["precio de tres por tres"],
    expect: "Interpreta 'tres por tres' = 3x3 igual que con dígitos y enruta a confeccionada (reforzada) cotizando 3x3; no se confunde por estar escrito con palabras." },
  { id: "cs-multiple-products", group: "coldstart", flow: "coldstart",
    turns: ["ocupo malla sombra y también ground cover"],
    expect: "Maneja que mencionó dos productos: pregunta cuál atender primero o los distingue; no mezcla ni ignora uno." },
  { id: "cs-location-question", group: "coldstart", flow: "coldstart",
    turns: ["¿hacen envíos a Monterrey?"],
    expect: "Responde sobre envío/cobertura y reencauza hacia qué producto/medida busca; no se queda sin enrutar." },
  { id: "cs-vague-interest", group: "coldstart", flow: "coldstart",
    turns: ["vi su anuncio, me interesa"],
    expect: "Pregunta qué producto/medida busca para enrutar; no asume ni cotiza a ciegas." },
  { id: "cs-complement-ojillos", group: "coldstart", flow: "coldstart",
    turns: ["venden ojillos sujetadores?"],
    expect: "Reconoce que SÍ los vendemos y los atiende (el cambio de flujo es transparente: una respuesta que pregunta por cuántas piezas o que cotiza el paquete YA es la atención correcta del flujo de Complementos); NUNCA niega el producto." },
  { id: "cs-complement-kit", group: "coldstart", flow: "coldstart",
    turns: ["tienen kit de instalación?"],
    expect: "Reconoce el kit y lo atiende/cotiza (el cambio de flujo es transparente: dar el precio + link del kit YA es la atención correcta del flujo de Complementos); NUNCA niega el producto." },
];

function flowDoc(cache, key) { return cache[key]; }

async function runCase(c, flowsCache) {
  const wf = flowsCache[c.flow];
  if (!wf) return { id: c.id, error: `flow '${c.flow}' not found/active` };
  let state = initState(wf);
  state.workflowId = String(wf._id);
  if (c.setup) state.setupOverrides = { ...(state.setupOverrides || {}), ...c.setup };
  const transcript = [];
  for (const msg of c.turns) {
    let out;
    try { out = await runWorkflowTurn(wf, state, msg, { psid: `BAT-${c.id}`, sandbox: true }); }
    catch (e) { return { id: c.id, group: c.group, flow: c.flow, error: e.message, transcript }; }
    state = out.state;
    const d = out.diagnostics || {};
    const sw = typeof d.switchedTo === "object" && d.switchedTo
      ? (d.switchedTo.name || d.switchedTo.workflowId || d.switchedTo.id || "?")
      : (d.switchedTo || "?");
    const tag = d.measureAutoSwitch ? `→switch:${sw}` : d.measureClarify ? "→clarify" : d.handoffRequested ? "→handoff" : "";
    transcript.push({ user: msg, bot: (out.reply || out.text || "(sin respuesta)").trim(), tag });
  }
  return { id: c.id, group: c.group, flow: c.flow, transcript, expect: c.expect };
}

async function judge(c, r) {
  const convo = r.transcript.map((t) => `CLIENTE: ${t.user}\nBOT: ${t.bot}${t.tag ? ` [${t.tag}]` : ""}`).join("\n");
  const res = await openai.chat.completions.create({
    model: "gpt-4o", temperature: 0, max_tokens: 120, response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `Eres QA del bot de ventas Hanlob (malla sombra), español mexicano. Te doy una conversación de prueba y el COMPORTAMIENTO ESPERADO. Decide si el bot lo cumplió. Sé estricto pero justo: respuestas breves o pedir un dato faltante NO son error si cumplen lo esperado. Devuelve SOLO JSON {"pass": true|false, "reason": "<breve>"}.` },
      { role: "user", content: `ESPERADO: ${r.expect}\n\nCONVERSACIÓN:\n${convo}` },
    ],
  });
  try { return JSON.parse(res.choices[0].message.content); } catch { return { pass: null, reason: "judge parse error" }; }
}

(async () => {
  const args = process.argv.slice(2);
  const smoke = args.includes("--smoke");
  const noJudge = args.includes("--no-judge");
  const flowArg = (args.find((a) => a.startsWith("--flow=")) || "").split("=")[1];
  const groupArg = (args.find((a) => a.startsWith("--group=")) || "").split("=")[1];

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const flowsCache = {};
  for (const [k, re] of Object.entries(FLOWS)) flowsCache[k] = await WF.findOne({ name: re, active: true });

  let cases = CASES;
  if (flowArg) cases = cases.filter((c) => c.flow.toLowerCase() === flowArg.toLowerCase());
  if (groupArg) cases = cases.filter((c) => c.group.toLowerCase() === groupArg.toLowerCase());
  if (smoke) cases = cases.filter((c) => c.group === "coldstart").slice(0, 1);

  console.log(`\n════════ SCENARIO BATTERY — ${cases.length} cases${smoke ? " (SMOKE)" : ""} ════════`);
  const byGroup = {};
  let pass = 0, fail = 0, err = 0;
  for (const c of cases) {
    const r = await runCase(c, flowsCache);
    if (r.error) { err++; console.log(`\n❌ [${c.group}/${c.id}] ERROR: ${r.error}`); continue; }
    let verdict = { pass: null, reason: "(judge skipped)" };
    if (!noJudge) verdict = await judge(c, r);
    (byGroup[c.group] = byGroup[c.group] || { p: 0, f: 0 });
    if (verdict.pass === true) { pass++; byGroup[c.group].p++; }
    else if (verdict.pass === false) { fail++; byGroup[c.group].f++; }
    const mark = verdict.pass === true ? "✅" : verdict.pass === false ? "❌" : "•";
    console.log(`\n${mark} [${c.group}/${c.id}] (${c.flow})`);
    for (const t of r.transcript) console.log(`   👤 ${t.user}\n   🤖 ${t.bot.slice(0, 160)}${t.tag ? `  [${t.tag}]` : ""}`);
    if (!noJudge) console.log(`   ⇒ ${verdict.pass ? "PASS" : "FAIL"}: ${verdict.reason}`);
  }
  if (!noJudge) {
    console.log(`\n════════ RESULT: ${pass} pass / ${fail} fail / ${err} err (of ${cases.length}) ════════`);
    console.log(Object.entries(byGroup).map(([g, v]) => `  ${g}: ${v.p}/${v.p + v.f}`).join("\n"));
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
