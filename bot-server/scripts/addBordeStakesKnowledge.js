// scripts/addBordeStakesKnowledge.js
//
// "¿TRAE ESTACAS?" — "Sí, trae estacas para fijarlo al suelo" (2026-11-17,
// wa:5218281000138, reported as "Inventó información": "El borde no lo vendemos con
// estacas"). The flow's 11 knowledge entries never mention estacas, so the model
// answered a yes/no question about what is in the box by guessing — and guessed yes.
// The fact is the team's own, from the report. It deliberately says nothing about
// whether stakes can be bought elsewhere or how to fix the borde: we were not told.
//
//   node scripts/addBordeStakesKnowledge.js          # dry run (default)
//   node scripts/addBordeStakesKnowledge.js --write
require("dotenv").config();
const mongoose = require("mongoose");

const TITLE = "Estacas / qué incluye el borde separador";
const CONTENT =
  "El BORDE SEPARADOR se vende SOLO: el rollo trae únicamente el borde. NO incluye estacas, " +
  "clavos, anclas, grapas ni ningún accesorio de fijación, y Hanlob NO vende el borde con " +
  "estacas. Contéstalo TÚ siempre que pregunten si trae estacas, si incluye algo para " +
  "fijarlo, o qué viene en el paquete: di con claridad que NO trae estacas, que es solo el " +
  "rollo de borde. NUNCA digas que sí las trae y NUNCA inventes qué accesorios incluye, " +
  "cómo se fija ni dónde conseguir estacas: si el cliente necesita más detalle sobre la " +
  "instalación, ofrécele pasarlo con un especialista.";

(async () => {
  const write = process.argv.includes("--write");
  await mongoose.connect(process.env.MONGODB_URI);
  const Workflow = require("../models/Workflow");
  const wf = await Workflow.findOne({ name: /Borde separador/i, active: true });
  if (!wf) throw new Error("borde workflow not found");
  const existing = (wf.knowledge || []).findIndex((k) => /estaca/i.test(k.title || ""));
  console.log(`flow: ${wf.name}\nknowledge entries: ${(wf.knowledge || []).length}`);
  console.log(existing >= 0 ? `→ replacing "${wf.knowledge[existing].title}"` : `→ adding "${TITLE}"`);
  console.log(`\n${CONTENT}\n`);
  if (!write) { console.log("(dry run — nothing written. Re-run with --write.)"); await mongoose.disconnect(); return; }
  if (existing >= 0) { wf.knowledge[existing].title = TITLE; wf.knowledge[existing].content = CONTENT; }
  else wf.knowledge.push({ title: TITLE, content: CONTENT });
  await wf.save();
  console.log(`✅ saved — ${wf.knowledge.length} knowledge entries`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
