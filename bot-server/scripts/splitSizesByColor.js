// Replicate the 6x4 per-color structure across all Rectangular size leaves.
// For each sellable size leaf (no children yet):
//   1. Turn the size node into a non-sellable PARENT, clear its links.
//   2. Create 3 sellable children:
//        - Color Beige  → inherits the size's ML link (moved) + price/dims
//        - Color Negro  → no link (attributes.color = "Negro")
//        - Color Verde  → no link (attributes.color = "Verde")
// Mirrors the 6x4 template (Beige has NO color attribute; Negro/Verde do).
// Skips size nodes that already have children (idempotent — 6x4 already split).
// Dry-run by default; pass --apply to write.
require("dotenv").config();
const mongoose = require("mongoose");
const PF = require("../models/ProductFamily");

const RECTANGULAR_ID = "6942d85ba539ce7f9f28429b";
const APPLY = process.argv.includes("--apply");

function mapToObj(m) {
  if (!m) return {};
  if (m instanceof Map) return Object.fromEntries(m);
  return { ...m };
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const sizeNodes = await PF.find({ parentId: RECTANGULAR_ID }).lean();

  let toSplit = [], skipped = [];
  for (const s of sizeNodes) {
    const childCount = await PF.countDocuments({ parentId: s._id });
    if (childCount > 0) { skipped.push(`${s.size} (already has ${childCount} children)`); continue; }
    if (!s.sellable) { skipped.push(`${s.size} (not sellable)`); continue; }
    toSplit.push(s);
  }

  console.log(`Rectangular size leaves: ${sizeNodes.length} | to split: ${toSplit.length} | skipped: ${skipped.length}`);
  console.log(`\nWill split (move link → Beige, Negro/Verde linkless):`);
  toSplit.forEach((s) => {
    const link = (s.onlineStoreLinks || [])[0]?.url || "(NO LINK)";
    console.log(`  ${s.size} $${s.price} → Beige(link: ${link.slice(0, 55)}), Negro(—), Verde(—)`);
  });
  if (skipped.length) console.log(`\nSkipped:\n  ${skipped.join("\n  ")}`);

  if (!APPLY) { console.log(`\n(dry-run — re-run with --apply to write)`); process.exit(0); }

  let done = 0;
  for (const s of toSplit) {
    const attrs = mapToObj(s.attributes);
    const dimUnits = mapToObj(s.dimensionUnits);
    const enabled = s.enabledDimensions || [];
    const movedLink = (s.onlineStoreLinks || [])[0] || null;
    const baseAttrs = {}; // beige: width/length only (no color), mirroring 6x4 template
    for (const k of ["width", "length", "height", "side1", "side2", "side3", "diameter", "thickness"]) {
      if (attrs[k] != null) baseAttrs[k] = attrs[k];
    }

    // 1) size node → non-sellable parent, links cleared
    const node = await PF.findById(s._id);
    node.sellable = false;
    node.onlineStoreLinks = [];
    await node.save();

    // 2) create children (parent is now non-sellable, so child save() passes the guard)
    const mkChild = async (colorName, withLink) => {
      const child = new PF({
        name: `Color ${colorName}`,
        parentId: s._id,
        size: s.size,
        sellable: true,
        active: true,
        price: s.price,
        mlPrice: s.mlPrice,
        enabledDimensions: [...enabled],
        dimensionUnits: new Map(Object.entries(dimUnits)),
        attributes: new Map(Object.entries(
          colorName === "Beige" ? baseAttrs : { ...baseAttrs, color: colorName }
        )),
        onlineStoreLinks: withLink && movedLink
          ? [{ url: movedLink.url, store: movedLink.store || "Mercado Libre", isPreferred: true }]
          : [],
      });
      await child.save();
    };
    await mkChild("Beige", true);
    await mkChild("Negro", false);
    await mkChild("Verde", false);

    console.log(`  ✔ ${s.size} split → Beige(link)/Negro/Verde`);
    done++;
  }
  console.log(`\n✅ Split ${done} sizes.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
