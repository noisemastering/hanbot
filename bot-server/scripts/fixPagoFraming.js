// fixPagoFraming.js — the "CÓMO SE PAGA" knowledge entry, in every active workflow.
//
// THE CLIENT'S RULE (2026-10-29, restated): "if the product is eligible for ML we
// mention that ML is an option, and for wholesale we accept transfers, but payments
// are always upfront." All eight entries opened with "la compra se realiza por Mercado
// Libre", which reads as ML-ONLY and buries the invariant. The gates (0-ter, a0-pago)
// now say it right on borde and ground cover; this is the same correction for the six
// flows that have no gate and rely on the model reading this entry.
//
//   node scripts/fixPagoFraming.js          # dry run (default)
//   node scripts/fixPagoFraming.js --write  # apply (writes a backup first)
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const OLD =
  "la compra se realiza por Mercado Libre con COMPRA PROTEGIDA (si no llega o llega mal, le devuelven su dinero) y el pago es al momento de ordenar en línea, con los medios que ofrece Mercado Libre (tarjeta, transferencia, efectivo en tiendas, meses sin intereses según la promoción). NO manejamos pago contra entrega, salvo que el cliente recoja directamente en nuestra planta en Querétaro.";

const NEW =
  "EL PAGO SIEMPRE ES POR ADELANTADO — nunca contra entrega. Si el producto está listado en Mercado Libre, menciona Mercado Libre como UNA OPCIÓN (compra protegida: si no llega o llega mal le devuelven su dinero, y ahí mismo paga al ordenar con tarjeta, transferencia, efectivo en tiendas o meses sin intereses según la promoción) — NO lo presentes como el único canal ni como un requisito. También puede comprar directo con nosotros por TRANSFERENCIA, que es además la forma en que se paga el MAYOREO. Y si pasa a la tienda, paga ahí con tarjeta o efectivo. NO manejamos pago contra entrega.";

(async () => {
  const write = process.argv.includes("--write");
  await mongoose.connect(process.env.MONGODB_URI);
  const Workflow = require("../models/Workflow");
  const wfs = await Workflow.find({ active: true });

  const backup = [];
  let hits = 0, misses = [];
  for (const w of wfs) {
    (w.knowledge || []).forEach((k, i) => {
      const field = ["answer", "text", "content"].find((f) => typeof k[f] === "string" && /C[OÓ]MO SE PAGA/i.test(k[f]));
      if (!field) return;
      if (!k[field].includes(OLD)) { misses.push(`${w.name} [${i}]`); return; }
      backup.push({ workflowId: String(w._id), workflow: w.name, index: i, field, before: k[field] });
      k[field] = k[field].replace(OLD, NEW);
      hits++;
      console.log(`  ✔ ${w.name} [knowledge ${i}]`);
    });
    if (write && backup.some((b) => b.workflowId === String(w._id))) {
      w.markModified("knowledge");
      await w.save();
    }
  }

  console.log(`\nentries rewritten: ${hits}`);
  if (misses.length) console.log(`⚠️ pago entry present but text did not match (left alone): ${misses.join(", ")}`);

  if (!write) {
    console.log("\n(dry run — nothing written. Re-run with --write to apply.)");
  } else {
    const f = path.join(__dirname, `_pagoFramingBackup_${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(f, JSON.stringify(backup, null, 2));
    console.log(`\n✅ applied. Backup: ${f}`);
  }
  await mongoose.disconnect();
})();
