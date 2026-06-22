// scripts/addZipAndHandoffData.js
//
// Standardize identity-capture across the sales flows so the proprietary sales
// correlation (name/zip) has data to match against:
//   1. Cotizar nodes → ask the CP right after sharing the buy/store link (so the
//      ML order's shipping zip can be correlated back to this conversation).
//   2. "Pasar a humano" nodes → for QUOTE handoffs, collect name + CP before
//      transferring (the asesor needs it AND it enables correlation). Urgent /
//      complaint handoffs are NOT blocked.
// The Rollo flow already does both → those nodes are skipped (idempotent: a node
// that already asks for "código postal" is left alone). Reversible (backup file).
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config();

const MARKER = "[CAPTURA-CP]";
const ZIP_RX = /código postal|codigo postal|\bC\.?P\.?\b/i;

const ZIP_ASK =
  "\n- " + MARKER + " DATOS PARA SEGUIMIENTO: justo después de compartir el link de compra, " +
  "pídele de forma natural su código postal (para confirmar cobertura y tiempo de envío y dar seguimiento a su pedido). " +
  "Hazlo en UNA sola frase, sin condicionar la compra ni sonar a formulario. Si ya lo dio antes, no lo vuelvas a pedir.";

const HANDOFF_DATA =
  "\n- " + MARKER + " Si el handoff es para una COTIZACIÓN (mayoreo, medida especial, precio especial, sin precio en línea), " +
  "ANTES de transferir pide el NOMBRE a quien va dirigida la cotización y su CÓDIGO POSTAL (para calcular el envío y dar seguimiento). " +
  "Si el cliente pide un humano por urgencia, queja o inconformidad, NO lo condiciones a dar datos: transfiere de inmediato. " +
  "Pásale al especialista los datos recabados junto con el contexto.";

// Apply to all real sales/triage flows (not "Dinámicas").
const FLOW_RX = /Confeccionada|Rollo|Borde|Coldstart/i;

(async () => {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(process.env.MONGODB_URI);
  const W = mongoose.connection.collection("workflows");
  const wfs = await W.find({}).toArray();
  const backup = [];
  const report = [];

  for (const w of wfs) {
    if (!FLOW_RX.test(w.name)) continue;
    const before = { _id: w._id, name: w.name, nodes: {} };
    let changed = false;
    const r = { name: w.name, zipAsk: "n/a", handoffData: "n/a" };

    const nodes = (w.nodes || []).map((n) => {
      const name = n.name || "";
      const prompt = n.prompt || "";

      // 1. Cotizar → zip ask after the link
      if (/cotizar/i.test(name)) {
        if (prompt.includes(MARKER)) { r.zipAsk = "already"; return n; }
        if (ZIP_RX.test(prompt)) { r.zipAsk = "already-has-zip"; return n; }
        before.nodes[n.id] = prompt; changed = true; r.zipAsk = "added";
        return { ...n, prompt: prompt + ZIP_ASK };
      }
      // 2. Pasar a humano → collect name+zip on quote handoffs
      if (/pasar a humano|handoff/i.test(name)) {
        if (prompt.includes(MARKER)) { r.handoffData = "already"; return n; }
        if (ZIP_RX.test(prompt)) { r.handoffData = "already-has-zip"; return n; }
        before.nodes[n.id] = prompt; changed = true; r.handoffData = "added";
        return { ...n, prompt: prompt + HANDOFF_DATA };
      }
      return n;
    });

    report.push(r);
    if (changed) {
      backup.push(before);
      if (apply) await W.updateOne({ _id: w._id }, { $set: { nodes } });
    }
  }

  console.log(JSON.stringify(report, null, 2));
  if (apply) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const f = path.join(__dirname, `_zipHandoffBackup_${stamp}.json`);
    fs.writeFileSync(f, JSON.stringify(backup, null, 2));
    console.log(`\n✅ Applied to ${backup.length} workflows. Backup: ${f}`);
  } else {
    console.log("\n(DRY RUN — re-run with --apply to write + back up.)");
  }
  await mongoose.connection.close();
})().catch((e) => { console.error(e); process.exit(1); });
