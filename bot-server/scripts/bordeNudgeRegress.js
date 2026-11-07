// scripts/bordeNudgeRegress.js
//
// THE BORDE CATCH-ALL IS NO LONGER A CATCH-ALL — this is the proof (2026-11-06,
// wa:5214622537550, the NINTH report of the same shape: "Q colores tienes" got the
// nudge, got it again, then "Verde" got it, then "Eras en irapuato" got it; Noemí
// answered the colour question by hand the next morning).
//
// §B used to answer ANY turn that carried neither a length nor a count, and every fix
// taught it one more exception — deferral, courtesy, metros lineales, pago, envío, dónde
// se consigue, otro producto, 500 m — while the next phrasing walked past it. It now
// answers ONLY a confirmation or an empty acknowledgement; anything else goes to the
// model with what we already quoted handed over as context.
//
// This script replays, after the four lengths are quoted, EVERY message that previously
// had to be rescued from that gate. Each must still get its own deterministic answer —
// narrowing the catch-all must not re-open any of the nine — and the colour question
// must reach the model.
//
// Needs the DB and the LLM (it drives the real flow). Read the output; it is not
// self-asserting, because what counts as a good MODEL answer is a judgement.
//
//   node scripts/bordeNudgeRegress.js
const mongoose = require("mongoose");
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  require("../models/ProductFamily");
  const Workflow = require("../models/Workflow");
  const { runWorkflowTurn, initState } = require("../ai/workflow");
  const wf = await Workflow.findOne({ name: /Borde separador/i, active: true });

  // Every message that previously had to be rescued FROM the §B catch-all, replayed
  // after the four lengths were quoted. Each must still get its deterministic gate.
  const CASES = [
    ["sí claro", "nudge (the ack it was built for)"],
    ["gracias", "deferral/courtesy"],
    ["20900", "CP"],
    ["👍", "wordless"],
    ["Esas son las medidas es en cuadrado", "metros lineales (0-bis)"],
    ["Los pagos son a contra entrega", "pago (0-ter)"],
    ["Incluye envío ? Estoy en puerto escondido Oax ?", "envío (0-quater)"],
    ["Y modo de entrega", "entrega = envío"],
    ["En dónde se consigue", "dónde (0-quinquies)"],
    ["Malla Anti malesa", "otro producto → routing"],
    ["500 ml aprox precio", "run > longest roll → mayoreo"],
    ["Voy a chequear", "deferral"],
    ["Yo lo paso a recoger y a pagar", "pickup (new)"],
    ["Ya te dije lo que quiero", "frustration (new)"],
    ["Q colores tienes", "colour → model (the reported bug)"],
  ];
  for (const [msg, label] of CASES) {
    let st = initState(wf);
    let r = await runWorkflowTurn(wf, st, "¡Hola! Quiero más información", { psid: "sbx_rg", sandbox: true });
    r = await runWorkflowTurn(wf, r.state, msg, { psid: "sbx_rg", sandbox: true });
    const d = r.diagnostics || {};
    const fired = Object.entries(d)
      .filter(([k, v]) => !["workflow", "fromNode", "toNode", "edgeId", "routerReason", "terminal"].includes(k) && v !== null && v !== false && !(Array.isArray(v) && !v.length))
      .map(([k]) => k).join(",") || "MODEL";
    console.log(`\n▸ ${label}\n  👤 ${msg}\n  🤖 ${String(r.reply).replace(/\n/g, " | ").slice(0, 150)}\n  [${fired}]`);
  }
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
