// General recovery for leaves whose dimension attributes got zeroed by the
// propagateDimensionValuesToDescendants bug (a category parent's "0" values
// overwriting children's real dims on re-parent). Scans the WHOLE catalog,
// finds sellable leaves whose `size` parses cleanly but whose width/length
// (or side1/2/3 for triangles) are "0"/empty/missing, and restores them from
// `size`. Idempotent. Dry-run unless --apply is passed.
require("dotenv").config();
const mongoose = require("mongoose");
const PF = require("../models/ProductFamily");

const APPLY = process.argv.includes("--apply");

// Parse a size string into dimension key/value pairs.
//   "6x4m"     → { width: "6", length: "4" }
//   "5x5x5m"   → { side1: "5", side2: "5", side3: "5" }
function parseSize(size) {
  if (!size) return null;
  const nums = String(size).toLowerCase().replace(/\s/g, "").replace(/m$/i, "").split(/x/).map((n) => n.trim());
  if (nums.some((n) => !/^\d+(\.\d+)?$/.test(n))) return null;
  if (nums.length === 2) return { width: nums[0], length: nums[1] };
  if (nums.length === 3) return { side1: nums[0], side2: nums[1], side3: nums[2] };
  return null;
}

// Bug fingerprint: a dimension explicitly set to "0" (a real product can never
// be 0 m). We ONLY restore these — they're unambiguously the propagation bug
// overwriting a real value. A merely-missing dimension key is left alone
// (could be intentionally partial, e.g. some borde/rollo entries) and reported.
const isExplicitZero = (v) => v != null && String(v).trim() === "0";
const isMissing = (v) => v == null || String(v).trim() === "";

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const leaves = await PF.find({ sellable: true, size: { $exists: true, $ne: null, $ne: "" } }).lean();

  let toFix = [], partial = [], unparseable = [], ok = 0;
  for (const l of leaves) {
    const parsed = parseSize(l.size);
    if (!parsed) { unparseable.push(`${l.name} (size=${JSON.stringify(l.size)})`); continue; }
    const attrs = l.attributes || {};
    const cur = Object.fromEntries(Object.keys(parsed).map((k) => [k, attrs[k]]));
    const hasZero = Object.keys(parsed).some((k) => isExplicitZero(attrs[k]));
    const hasMissing = Object.keys(parsed).some((k) => isMissing(attrs[k]));
    if (hasZero) {
      toFix.push({ id: l._id, name: l.name, size: l.size, parsed, current: cur });
    } else if (hasMissing) {
      partial.push(`${l.size} (current ${JSON.stringify(cur)})`);
    } else {
      ok++;
    }
  }

  console.log(`Scanned ${leaves.length} sellable leaves. ok=${ok} zeroedNeedFix=${toFix.length} partial(skipped)=${partial.length} unparseable=${unparseable.length}`);
  toFix.slice(0, 60).forEach((t) => console.log(`  ${APPLY ? "FIX" : "would fix"} ${t.size} → ${JSON.stringify(t.parsed)} (was ${JSON.stringify(t.current)})`));
  if (toFix.length > 60) console.log(`  … +${toFix.length - 60} more`);
  if (partial.length) console.log(`\nPartial dims (NOT a zero — left untouched, review if needed):\n  ${partial.join("\n  ")}`);
  if (unparseable.length) console.log(`\nUnparseable (left untouched):\n  ${unparseable.join("\n  ")}`);

  if (APPLY) {
    for (const t of toFix) {
      const set = {};
      for (const [k, v] of Object.entries(t.parsed)) set[`attributes.${k}`] = v;
      await PF.updateOne({ _id: t.id }, { $set: set });
    }
    console.log(`\n✅ Applied ${toFix.length} fixes.`);
  } else {
    console.log(`\n(dry-run — re-run with --apply to write)`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
