// setColonAddress.js — move CompanyInfo to the Colón plant.
//
// WHY THIS IS A SCRIPT AND NOT A CODE CHANGE: the address is DATA (CompanyInfo,
// editable at /company-info in the dashboard). This script exists only so the move
// can be applied in one command; the dashboard does the same thing.
//
// WHERE THESE VALUES COME FROM — not invented. They are the team's OWN address
// template, sent to customers since 2026-10-21 (psids 28826973420257193,
// 39032410619736683, wa:5213781040122, wa:5212461613346), and the Google Maps short
// link inside it, which resolves to the place "Hanlob Colón" @20.7588452,-100.0435531.
// The team's template still carried a stale "C.P. 76137, Santiago de Querétaro" tail
// under the new address; that tail is dropped here.
//
//   node scripts/setColonAddress.js          # dry run (default)
//   node scripts/setColonAddress.js --write  # apply
require("dotenv").config();
const mongoose = require("mongoose");

const NEW = {
  address: "QRO 110 7380, El Arroyito",
  city: "Colón",
  state: "Querétaro",
  zipCode: "76286",
  googleMapsUrl: "https://maps.app.goo.gl/7g9HmoY4TtaHQ26e8",
};

const CANNED = `Buen día, con gusto le atendemos. Estamos en Colón, Querétaro y despachamos a toda la República. Le comparto nuestra dirección y ubicación en Google Maps:

HANLOB — Planta Colón
QRO 110 7380, El Arroyito
Colón, Qro., C.P. 76286

${NEW.googleMapsUrl}`;

(async () => {
  const write = process.argv.includes("--write");
  await mongoose.connect(process.env.MONGODB_URI);
  const CompanyInfo = require("../models/CompanyInfo");
  const CannedMessage = require("../models/CannedMessage");

  const before = await CompanyInfo.findById("hanlob").lean();
  const shown = (o) => ["address", "city", "state", "zipCode", "googleMapsUrl"].map((k) => `  ${k}: ${o?.[k] || "—"}`).join("\n");
  console.log("CompanyInfo BEFORE:\n" + shown(before));
  console.log("CompanyInfo AFTER:\n" + shown(NEW));

  const cm = await CannedMessage.findOne({ title: /Direcci[oó]n|Ubicaci[oó]n/i });
  console.log("\nCanned message:", cm ? `"${cm.title}" will be rewritten` : "⚠️ none found — check by hand");

  if (!write) {
    console.log("\n(dry run — nothing written. Re-run with --write to apply.)");
    await mongoose.disconnect();
    return;
  }

  await CompanyInfo.updateOne({ _id: "hanlob" }, { $set: { ...NEW, lastEditedAt: new Date() } });
  if (cm) { cm.text = CANNED; await cm.save(); }
  // The bot caches this; drop the cache so it takes effect without a redeploy.
  try { require("../businessInfoManager").invalidateCache(); } catch (_) {}
  console.log("\n✅ applied. The bot's move notice retires itself now that the zip is no longer 76137.");
  await mongoose.disconnect();
})();
