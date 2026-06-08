// One-off repair: the familias re-parent (move under "Color Beige") zeroed the
// dimension attributes on the 38 Rectangular leaves (attributes.width/length
// became "0"). The `size` string ("6x4m") survived, so we re-derive width/length
// from it. Triangular children were unaffected. Idempotent: only touches leaves
// whose width/length is "0"/empty and whose size parses cleanly.
require("dotenv").config();
const mongoose = require("mongoose");
const PF = require("../models/ProductFamily");

const RECTANGULAR_ID = "6942d85ba539ce7f9f28429b";

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const kids = await PF.find({ parentId: RECTANGULAR_ID }).lean();
  let fixed = 0, skipped = 0, unparseable = [];

  for (const k of kids) {
    const attrs = k.attributes || {};
    const w = attrs.width, l = attrs.length;
    const needsFix = (w === "0" || w == null || w === "") || (l === "0" || l == null || l === "");
    if (!needsFix) { skipped++; continue; }

    // Parse "6x4m" / "6x4" / "6 x 4 m" → [6, 4]
    const m = String(k.size || "").toLowerCase().replace(/\s/g, "").match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)m?$/);
    if (!m) { unparseable.push(`${k.name} (size=${JSON.stringify(k.size)})`); continue; }

    const width = m[1], length = m[2];
    await PF.updateOne(
      { _id: k._id },
      { $set: { "attributes.width": width, "attributes.length": length } }
    );
    console.log(`  ✔ ${k.size} → width=${width} length=${length}`);
    fixed++;
  }

  console.log(`\nDone. fixed=${fixed} skipped(already-ok)=${skipped} unparseable=${unparseable.length}`);
  if (unparseable.length) console.log("Unparseable:\n  " + unparseable.join("\n  "));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
