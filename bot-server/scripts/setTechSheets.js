// scripts/setTechSheets.js
//
// Register the FICHA TÉCNICA PDFs on the product families (2026-11-06, psid
// 28508399788837176: "Quiero características de ese ground cover . Grosor" → promo
// prices; Noemí answered it with the file three hours later).
//
// Where the file comes from, since uploading one of our own invention would be the
// worse failure: it is the PDF the asesora herself sent in that conversation, already
// in OUR Cloudinary account. Verified contents (pdftotext): USOS, PRESENTACIÓN (rollo
// de 2x100 y 4x100), COLORES negro y blanco, GRAMAJE 105 gr/m², TIPO DE TEJIDO de punto,
// POLÍMERO HDPE, RESISTENCIA UV 720 KLYS, DENSIDAD DE HILOS 10.5x10 pulgadas.
//
// Dry run by default. `node scripts/setTechSheets.js --write` to apply.
//
// Only Ground Cover has a sheet today. Malla Sombra Raschel and the borde separador do
// NOT, and customers have asked for theirs repeatedly ("Ficha técnica de su malla
// sombra", "Tendrá ficha técnica de la malla") — until those files exist the bot must
// not offer them, which is what resolveTechSheet returning null enforces.

require("dotenv").config();
const mongoose = require("mongoose");

const WRITE = process.argv.includes("--write");

const SHEETS = [
  {
    family: "Ground Cover", // root family (parentId: null)
    url:
      "https://res.cloudinary.com/difxm1uoz/raw/upload/v1794004377/hanlob/conversation-docs/" +
      "1794004376606_Ground_cover_Ficha_T__cnica_Hanlob_compressed.pdf",
    publicId:
      "hanlob/conversation-docs/1794004376606_Ground_cover_Ficha_T__cnica_Hanlob_compressed.pdf",
    name: "Ficha_Tecnica_Ground_Cover_Hanlob.pdf",
    label: "la malla antimaleza (Ground Cover)",
  },
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const PF = require("../models/ProductFamily");

  for (const s of SHEETS) {
    const fam = await PF.findOne({ name: s.family, parentId: null });
    if (!fam) {
      console.log(`❌ family not found: ${s.family}`);
      continue;
    }
    const had = fam.techSheet?.url || null;
    console.log(`\n${WRITE ? "WRITE" : "DRY  "} ${fam.name} (${fam._id})`);
    console.log(`      antes:   ${had || "(sin ficha)"}`);
    console.log(`      después: ${s.url}`);
    console.log(`      archivo: ${s.name} · etiqueta: "${s.label}"`);
    if (!WRITE) continue;
    fam.techSheet = {
      url: s.url,
      publicId: s.publicId,
      name: s.name,
      label: s.label,
      uploadedAt: new Date(),
    };
    await fam.save();
    console.log("      ✅ guardado");
  }

  if (WRITE) {
    const all = await PF.find({ "techSheet.url": { $ne: null } }).select("name techSheet").lean();
    console.log(`\nfamilias con ficha técnica: ${all.length}`);
    for (const a of all) console.log(`  · ${a.name} → ${a.techSheet.name}`);
  }
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
