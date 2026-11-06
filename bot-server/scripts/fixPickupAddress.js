// scripts/fixPickupAddress.js
//
// THE ADDRESS WE SEND A CUSTOMER WHO IS DRIVING OVER HAS TO BE THE RIGHT ONE
// (2026-11-06, psid 28881861821437120).
//
// Ernesto said "Yo lo paso a recoger y a pagar" and nobody told him where we are. The
// pickup gate shipped today answers that — which makes two stale CompanyInfo fields
// load-bearing for the first time:
//
//   · city          "Santiago de Querétaro" — we are in COLÓN. It is printed in the
//                   first line of the pickup answer ("Estamos en …") AND inside
//                   fullAddress, where it also DUPLICATED the tail the address field
//                   already carried.
//   · googleMapsUrl still the OLD Navex Park pin (@20.5946169,-100.4630917). A wrong
//                   map is worse than no map: it sends somebody to the wrong town.
//
// Both were known-pending since 2026-10-29 ("we'll add it later on"); a pickup
// instruction is what made them urgent.
//
// WHERE THE VALUES COME FROM — not invented: the team's own address template, sent to
// customers since 2026-10-21, and its Google Maps short link, which resolves to the
// place "Hanlob Colón" @20.7588452,-100.0435531. Noemí sent that same link in THIS
// conversation. The STREET LINE is left exactly as the team typed it in /company-info
// ("Carretera Estatal QRO 110, No. 7380, El Lindero") — only the duplicated
// city/state/zip tail is trimmed off it, because fullAddress appends those itself.
//
//   node scripts/fixPickupAddress.js          # dry run (default)
//   node scripts/fixPickupAddress.js --write
require("dotenv").config();
const mongoose = require("mongoose");

const MAPS = "https://maps.app.goo.gl/7g9HmoY4TtaHQ26e8";
const OLD_PIN = /@20\.5946169,-100\.4630917/;

(async () => {
  const write = process.argv.includes("--write");
  await mongoose.connect(process.env.MONGODB_URI);
  const CompanyInfo = require("../models/CompanyInfo");

  const before = await CompanyInfo.findOne().lean();
  if (!before) throw new Error("no CompanyInfo document");

  const set = {};
  if (String(before.city || "").trim() !== "Colón") set.city = "Colón";
  if (OLD_PIN.test(String(before.googleMapsUrl || "")) || !String(before.googleMapsUrl || "").includes("maps.app.goo.gl")) {
    set.googleMapsUrl = MAPS;
  }
  // Trim the city/state/zip tail the street line duplicates — fullAddress adds them.
  const street = String(before.address || "")
    .replace(/,?\s*Col[oó]n,?\s*Quer[eé]taro.*$/i, "")
    .replace(/,?\s*C\.?P\.?\s*\d{5}.*$/i, "")
    .replace(/,?\s*M[eé]xico\.?\s*$/i, "")
    .replace(/[\s,.]+$/, "")
    .trim();
  if (street && street !== String(before.address || "").trim()) set.address = street;

  const fullOf = (o) => [o.address, o.city, o.state, o.zipCode ? `C.P. ${o.zipCode}` : ""].filter(Boolean).join(", ");
  console.log("BEFORE");
  console.log("  city:  ", before.city);
  console.log("  maps:  ", before.googleMapsUrl);
  console.log("  dir:   ", fullOf(before));
  const after = { ...before, ...set };
  console.log("AFTER");
  console.log("  city:  ", after.city);
  console.log("  maps:  ", after.googleMapsUrl);
  console.log("  dir:   ", fullOf(after));

  if (!Object.keys(set).length) { console.log("\nnothing to change."); await mongoose.disconnect(); return; }
  if (!write) { console.log(`\n(dry run — ${Object.keys(set).join(", ")} would change. Re-run with --write.)`); await mongoose.disconnect(); return; }

  await CompanyInfo.updateOne({ _id: before._id }, { $set: { ...set, lastEditedAt: new Date() } });
  // The bot serves a 5-minute cache and warms MAPS_URL / STORE_ADDRESS / SHORT_LOCATION
  // once; without this the change only reaches customers after the next redeploy.
  try { require("../businessInfoManager").invalidateCache(); } catch (_) { /* best effort */ }
  console.log(`\n✅ applied: ${Object.keys(set).join(", ")}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
