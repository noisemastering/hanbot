// scripts/addCustomSizeFact.js
//
// We DO fabricate malla sombra to custom size ("sobre medida"). The workflow
// flows never stated this, so the bot wrongly denied it. This appends the
// custom-size fact to the globalPrompt of the malla flows + coldstart, and
// reframes the existing "medida especial → handoff" rule in Cotizar from a bare
// escalation into an affirmative "sí la fabricamos, el asesor cotiza".
//
// Custom sizes are NOT auto-priced (no fixed ML listing/link): nearest standard
// stays buyable-now; the exact custom size goes to an asesor for a personalized
// quote — consistent with the legacy handleCustomSize policy + deterministic
// pricing. Idempotent (marker check) and reversible (backs up originals).
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config();

const MARKER = "FABRICAMOS A LA MEDIDA";

const FACT = {
  confeccionada:
    "\n\nFABRICAMOS A LA MEDIDA: hacemos malla sombra confeccionada a la medida que el cliente necesite. " +
    "Si preguntan si manejamos medidas especiales o \"sobre medida\", la respuesta es SÍ — NUNCA digas que no las hacemos. " +
    "Tenemos medidas estándar listas para envío inmediato (con link de compra); para una medida especial, un asesor hace la cotización personalizada. " +
    "Ofrece la medida estándar más cercana como opción de envío inmediato y, si el cliente quiere la medida exacta, pásalo con un asesor para cotizarla. NUNCA inventes el precio de una medida especial.",
  rollo:
    "\n\nFABRICAMOS A LA MEDIDA: cortamos el rollo al largo que el cliente necesite. " +
    "Si preguntan si manejamos medidas especiales o \"sobre medida\", la respuesta es SÍ — NUNCA digas que no. " +
    "Tenemos presentaciones estándar listas para envío inmediato (con link); para un corte especial, un asesor hace la cotización personalizada. NUNCA inventes el precio de un corte especial.",
  coldstart:
    "\n\nFABRICAMOS A LA MEDIDA: Hanlob fabrica malla sombra a la medida. " +
    "Si preguntan si hacen medidas especiales o \"sobre medida\", la respuesta es SÍ — NUNCA digas que no; encamina al cliente al flujo del producto para tomar su medida.",
};

const TARGETS = [
  { match: /Confeccionada con Refuerzo.*Retail/i, fact: FACT.confeccionada, reframeCotizar: true },
  { match: /Confeccionada Sin Refuerzo.*Retail/i, fact: FACT.confeccionada, reframeCotizar: true },
  { match: /Malla Sombra — Rollo/i, fact: FACT.rollo, reframeCotizar: true },
  { match: /^Coldstart$/i, fact: FACT.coldstart, reframeCotizar: false },
];

// The bare-escalation sentence → affirmative fabrication.
const COTIZAR_OLD = /Si ambos lados son >= ?8 metros o el cliente confirma que quiere una medida con decimales,?\s*entonces es una medida especial y debes hacer handoff a un humano\.?/i;
const COTIZAR_NEW =
  "Si ambos lados son >= 8 metros o el cliente confirma que quiere una medida con decimales, es una MEDIDA ESPECIAL: SÍ la fabricamos a la medida. Díselo con naturalidad (\"sí la hacemos a tu medida\") y pásalo con un asesor para la cotización personalizada (usa request_handoff). NUNCA digas que no la hacemos ni inventes un precio para la medida especial.";

(async () => {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(process.env.MONGODB_URI);
  const W = mongoose.connection.collection("workflows");
  const wfs = await W.find({}).toArray();
  const backup = [];
  const report = [];

  for (const w of wfs) {
    const t = TARGETS.find((x) => x.match.test(w.name));
    if (!t) continue;

    const changes = {};
    const before = { _id: w._id, globalPrompt: w.globalPrompt, cotizar: null };

    // 1. globalPrompt fact (idempotent)
    let gp = w.globalPrompt || "";
    if (!gp.includes(MARKER)) {
      gp = gp + t.fact;
      changes.globalPrompt = gp;
    }

    // 2. reframe Cotizar bullet
    let nodes = w.nodes || [];
    if (t.reframeCotizar) {
      nodes = nodes.map((n) => {
        if (/cotizar/i.test(n.name || "") && n.prompt && COTIZAR_OLD.test(n.prompt)) {
          before.cotizar = { id: n.id, prompt: n.prompt };
          return { ...n, prompt: n.prompt.replace(COTIZAR_OLD, COTIZAR_NEW) };
        }
        return n;
      });
    }
    const cotizarChanged = JSON.stringify(nodes) !== JSON.stringify(w.nodes || []);
    if (cotizarChanged) changes.nodes = nodes;

    report.push({
      name: w.name,
      globalPromptAppended: !!changes.globalPrompt,
      cotizarReframed: cotizarChanged,
    });
    if (Object.keys(changes).length) {
      backup.push(before);
      if (apply) await W.updateOne({ _id: w._id }, { $set: changes });
    }
  }

  console.log(JSON.stringify(report, null, 2));
  if (apply) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const f = path.join(__dirname, `_customSizeBackup_${stamp}.json`);
    fs.writeFileSync(f, JSON.stringify(backup, null, 2));
    console.log(`\n✅ Applied to ${backup.length} workflows. Backup: ${f}`);
  } else {
    console.log("\n(DRY RUN — re-run with --apply to write + back up.)");
  }
  await mongoose.connection.close();
})().catch((e) => { console.error(e); process.exit(1); });
