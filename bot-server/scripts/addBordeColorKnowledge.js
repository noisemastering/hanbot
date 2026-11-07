// scripts/addBordeColorKnowledge.js
//
// THE BORDE IS NEGRO, AND THE FLOW HAD NOWHERE TO READ THAT (2026-11-06,
// wa:5214622537550, "No respondió lo que se preguntó").
//
// "Q colores tienes" got the nudge, twice; "Verde" got it; and Noemí answered it the
// next morning by hand: *"Una disculpa este borde solo lo tengo en color negro."* The
// gate swallowing the turn was half the bug; the other half is that the flow's 10
// knowledge entries say NOTHING about colour (checked: 0 mentions), so even reaching
// the model would have meant it improvising — the "solo beige" class of answer.
//
// Verified against the catalogue, not invented: Borde Separador → Grueso / Delgado →
// "Rollo de 6/9/18/54 m", and those length rolls ARE the sellable leaves — there are no
// colour children anywhere under either version, and the live ML listing is named
// "…-grueso-negro". So: negro only, both versions.
//
//   node scripts/addBordeColorKnowledge.js          # dry run (default)
//   node scripts/addBordeColorKnowledge.js --write
require("dotenv").config();
const mongoose = require("mongoose");

const TITLE = "Colores del borde separador";
const CONTENT =
  "El BORDE SEPARADOR se maneja ÚNICAMENTE EN NEGRO — las dos versiones (grueso y delgado) " +
  "son negras. No hay verde, blanco, café, beige ni ningún otro color, y NO es algo que se " +
  "pueda pedir en otro color. Contéstalo TÚ siempre que pregunten por color, colores, de qué " +
  "color es, si hay en tal color, o cuando mencionen un color suelto (\"verde\"): di que en " +
  "borde separador solo manejamos negro. NUNCA inventes un color, NUNCA lo cambies por " +
  "\"¿qué largo necesitas?\" sin contestar primero, y NUNCA escales por esta pregunta. " +
  "Si el cliente quería ese color en MALLA SOMBRA, esa sí viene en varios colores: dilo en " +
  "una frase y sigue.";

(async () => {
  const write = process.argv.includes("--write");
  await mongoose.connect(process.env.MONGODB_URI);
  const Workflow = require("../models/Workflow");

  const wf = await Workflow.findOne({ name: /Borde separador/i, active: true });
  if (!wf) throw new Error("borde workflow not found");
  const existing = (wf.knowledge || []).findIndex((k) => /color/i.test(k.title || ""));
  console.log(`flow: ${wf.name}`);
  console.log(`knowledge entries: ${(wf.knowledge || []).length}`);
  console.log(existing >= 0 ? `→ replacing "${wf.knowledge[existing].title}"` : `→ adding "${TITLE}"`);
  console.log(`\n${CONTENT}\n`);

  if (!write) { console.log("(dry run — nothing written. Re-run with --write.)"); await mongoose.disconnect(); return; }

  if (existing >= 0) {
    wf.knowledge[existing].title = TITLE;
    wf.knowledge[existing].content = CONTENT;
  } else {
    wf.knowledge.push({ title: TITLE, content: CONTENT });
  }
  await wf.save();
  console.log(`✅ saved — ${wf.knowledge.length} knowledge entries`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
