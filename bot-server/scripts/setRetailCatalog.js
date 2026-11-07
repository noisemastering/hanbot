// scripts/setRetailCatalog.js
//
// THE BOT WAS SENDING THE DISTRIBUTOR PRICE LIST TO RETAIL CUSTOMERS (2026-11-06).
//
// `CompanyInfo.catalog` — the file the bot attaches when anyone asks for "el catálogo" —
// is `Hanlob_Precios_Distribuidores_Mallas_Reforzada_2026`: 2 pages, headed "¡PRECIOS
// PARA DISTRIBUIDORES!", a wholesale price list. What the team sends customers by hand is
// `Hanlob_catalogo_2026.pdf`: 24 pages, "CATÁLOGO 2026 — Fábrica de malla sombra y
// productos para jardín". Both verified by reading the PDFs.
//
// Evidence that the retail one is the right default, not a guess: the team has sent it
// 10 times in the last two weeks (the most-sent document in the whole message history
// after the 2025 catalogue), including by Noemí in the very conversation that was
// reported — psid 29499442322972928, where the bot had already attached the DISTRIBUTOR
// list minutes earlier.
//
// No code change goes with this: a distributor enquiry is already handed to a person by
// the wholesale gate (§1.065), so the bot never needs to be the one sending wholesale
// prices. The asesoras keep sending that list themselves.
//
//   node scripts/setRetailCatalog.js          # dry run (default)
//   node scripts/setRetailCatalog.js --write
require("dotenv").config();
const mongoose = require("mongoose");

const RETAIL = {
  url:
    "https://res.cloudinary.com/difxm1uoz/raw/upload/v1793978185/hanlob/conversation-docs/" +
    "1793978184246_Hanlob_catalogo_2026.pdf",
  publicId: "hanlob/conversation-docs/1793978184246_Hanlob_catalogo_2026.pdf",
  name: "Hanlob_Catalogo_2026.pdf",
};

(async () => {
  const write = process.argv.includes("--write");
  await mongoose.connect(process.env.MONGODB_URI);
  const CompanyInfo = require("../models/CompanyInfo");
  const before = await CompanyInfo.findOne().lean();
  console.log("BEFORE:", before?.catalog?.name || "(none)");
  console.log("        ", before?.catalog?.url || "");
  console.log("AFTER :", RETAIL.name);
  console.log("        ", RETAIL.url);
  if (!write) { console.log("\n(dry run — nothing written. Re-run with --write.)"); await mongoose.disconnect(); return; }
  await CompanyInfo.updateOne(
    { _id: before._id },
    { $set: { catalog: { ...RETAIL, uploadedAt: new Date() }, lastEditedAt: new Date() } }
  );
  try { require("../businessInfoManager").invalidateCache(); } catch (_) { /* best effort */ }
  console.log("\n✅ applied — the bot now attaches the retail catalogue.");
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
