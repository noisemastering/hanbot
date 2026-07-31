// scripts/generateProductIds.js
//
// Assigns a human-readable, attribute-encoded productCode to every SELLABLE
// product leaf. This code is the permanent join key between MongoDB and the
// future SQL/warehouse/production database, so it is DETERMINISTIC (derived
// from the product's own attributes + its place in the ProductFamily tree) —
// both databases can compute the same key without a shared counter.
//
// Format:  CAT-TYPE-[SHADE]-[COLOR]-[SIZE]   (uppercase, hyphen-segmented)
//   CAT   root family        MSR | GC | HER | SUJ | CIN | COR
//   TYPE  form/subtype       REF | SIN | ROL | KIT | OJI | BOR | LAZ ...
//   SHADE shade %            90 | 70 | 50   (malla only; omitted otherwise)
//   COLOR leaf color         BEI | NEG | VER | BLA | GRI (omitted if none)
//   SIZE  dimensions         07X07 | 02X100 | 18M | 10PZ (omitted if discrete)
//
// Usage:
//   node scripts/generateProductIds.js           # DRY RUN — prints, writes nothing
//   node scripts/generateProductIds.js --write    # writes productCode to prod
require("dotenv").config();
const mongoose = require("mongoose");

const WRITE = process.argv.includes("--write");

// ─── segment vocabularies ─────────────────────────────────────────────────
const CAT = [
  [/malla sombra raschel/i, "MSR"],
  [/ground cover/i, "GC"],
  [/herrajes/i, "HER"],
  [/sujetadores/i, "SUJ"],
  [/cinta pl[aá]stica/i, "CIN"],
  [/cordones|lazos/i, "COR"],
];
// Order matters: specific complemento/borde keywords are checked BEFORE the
// generic "rollo" (a borde is packaged as a "Rollo de N m" but is a BORDE), and
// "sin refuerzo" before "refuerzo".
const TYPE = [
  [/kit/i, "KIT"],
  [/ojillo|sujetador/i, "OJI"],
  [/borde/i, "BOR"],
  [/lazo|cord[oó]n/i, "LAZ"],
  [/sin refuerzo/i, "SIN"],
  [/refuerzo|reforzada/i, "REF"],
  [/rollo/i, "ROL"],
];
const COLOR = [
  [/beige/i, "BEI"],
  [/negro|black/i, "NEG"],
  [/verde|green/i, "VER"],
  [/blanco|white/i, "BLA"],
  [/gris|gray|grey/i, "GRI"],
];
// Thickness (borde separador) — occupies the 4th slot when there's no color.
const THICK = [
  [/grueso/i, "GRU"],
  [/delgado|delgada|fino|fina/i, "DEL"],
];
const first = (table, str) => {
  if (!str) return null;
  for (const [re, code] of table) if (re.test(str)) return code;
  return null;
};

// zero-pad a dimension to 2 digits minimum (7→07, 2→02, 100→100)
const padDim = (v) => {
  const n = String(v).replace(/[^\d.]/g, "");
  if (!n) return null;
  const int = n.split(".")[0];
  return int.length < 2 ? int.padStart(2, "0") : int;
};

function deriveSegments(leaf, path) {
  const names = path.map((p) => p.name || "").join(" · ");
  const cat = first(CAT, names) || "UNK";
  const type = first(TYPE, names) || null;

  // SHADE — any node like "90%"
  let shade = null;
  for (const p of path) {
    const mm = String(p.name || "").match(/(\d{2,3})\s*%/);
    if (mm) { shade = mm[1]; break; }
  }

  // 4th slot — COLOR (malla/GC) or, when there's no color, THICKNESS (borde).
  let color =
    first(COLOR, leaf.attributes?.color) || first(COLOR, leaf.name) || first(COLOR, names) || null;
  // Malla is sold beige unless another color is specified — sin-refuerzo and
  // triangular are beige-only — so default any color-less MSR leaf to BEI for a
  // uniform 5-segment code.
  if (!color && cat === "MSR") color = "BEI";
  const variant = color || first(THICK, names);

  // SIZE — prefer structured attributes, else parse the leaf name (some legacy
  // leaves carry their dimensions only in the name).
  const a = leaf.attributes || {};
  const nm = String(leaf.name || "");
  const nums = "(\\d+(?:\\.\\d+)?)\\s*m?";
  let size = null;
  if (a.width && a.length) size = `${padDim(a.width)}X${padDim(a.length)}`;
  else {
    const tri = nm.match(new RegExp(`${nums}\\s*[x×]\\s*${nums}\\s*[x×]\\s*${nums}`, "i"));
    const rect = nm.match(new RegExp(`${nums}\\s*[x×]\\s*${nums}`, "i"));
    if (tri) size = `${padDim(tri[1])}X${padDim(tri[2])}X${padDim(tri[3])}`; // 3 parts ⇒ triangular
    else if (rect) size = `${padDim(rect[1])}X${padDim(rect[2])}`;
    else if (a.length) size = `${padDim(a.length)}M`;
    else {
      const pk = nm.match(/paquete de (\d+)/i);
      if (pk) size = `${pk[1]}PZ`;
    }
  }

  return { cat, type, shade, color: variant, size };
}

const buildCode = (s) => [s.cat, s.type, s.shade, s.color, s.size].filter(Boolean).join("-");

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const PF = require("../models/ProductFamily");
  const all = await PF.find({}).lean();
  const byId = new Map(all.map((d) => [String(d._id), d]));
  const pathTo = (leaf) => {
    const p = [];
    let n = leaf;
    while (n) { p.unshift(n); n = n.parentId ? byId.get(String(n.parentId)) : null; }
    return p;
  };

  const leaves = all.filter((d) => d.sellable === true);
  const rows = leaves.map((leaf) => {
    const path = pathTo(leaf);
    const seg = deriveSegments(leaf, path);
    return { leaf, seg, code: buildCode(seg), pathStr: path.map((p) => p.name).join(" › ") };
  });

  // ── report ──
  const codes = rows.map((r) => r.code);
  const dupMap = {};
  codes.forEach((c) => (dupMap[c] = (dupMap[c] || 0) + 1));
  const dups = Object.entries(dupMap).filter(([, n]) => n > 1);
  const unmappedCat = rows.filter((r) => r.seg.cat === "UNK");
  const colorlessMalla = rows.filter((r) => r.seg.cat === "MSR" && !r.seg.color);

  const byCat = {};
  rows.forEach((r) => (byCat[r.seg.cat] = byCat[r.seg.cat] || []).push(r));

  console.log(`\n${WRITE ? "🟢 WRITE MODE" : "🔵 DRY RUN (no writes)"} — ${leaves.length} sellable leaves\n`);
  for (const [cat, list] of Object.entries(byCat)) {
    console.log(`── ${cat}  (${list.length}) ──`);
    list
      .sort((a, b) => a.code.localeCompare(b.code))
      .forEach((r) => console.log(`  ${r.code.padEnd(24)} ${r.leaf.name}`));
    console.log("");
  }

  console.log("═══ HEALTH ═══");
  console.log(`  unique codes      : ${new Set(codes).size} / ${codes.length}`);
  console.log(`  COLLISIONS        : ${dups.length}`, dups.map(([c, n]) => `${c}×${n}`).join(", "));
  console.log(`  unmapped category : ${unmappedCat.length}`, unmappedCat.slice(0, 8).map((r) => r.pathStr).join(" | "));
  console.log(`  color-less malla  : ${colorlessMalla.length}  (legacy-subtree candidates)`);
  if (colorlessMalla.length)
    console.log("    e.g.", colorlessMalla.slice(0, 6).map((r) => `${r.code} ← ${r.pathStr}`).join("\n         "));

  if (WRITE) {
    if (dups.length || unmappedCat.length) {
      console.log("\n⛔ Refusing to write: resolve collisions / unmapped categories first.");
    } else {
      let n = 0;
      for (const r of rows) { await PF.updateOne({ _id: r.leaf._id }, { $set: { productCode: r.code } }); n++; }
      console.log(`\n✅ Wrote productCode to ${n} docs.`);
    }
  } else {
    console.log("\n(dry run — re-run with --write once these look right)");
  }

  await mongoose.disconnect();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
