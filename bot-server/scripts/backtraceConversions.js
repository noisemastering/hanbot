// scripts/backtraceConversions.js
//
// FULL history re-evaluation of ML-order → click conversions with the CURRENT
// model (product-based ProductFamily.mlItemIds bridge + the identity tier table
// in utils/conversionCorrelation.js). Replaces the stale runCorrelation.js
// (which matched on the null click.mlItemId and stamped item-match = high).
//
// The expensive part of correlateOrder() is a per-order ML Shipments API call
// (~2.5s, throttled). Almost every ML order is NOT from a tracked click, so we
// PRE-FILTER candidates cheaply (in memory, no API): an order is a candidate
// only if one of its items maps to OUR product (via ProductFamily.mlItemIds)
// AND there is a click on that product within the 7-day window before the order.
// Only candidates get the full correlateOrder() (shipment fetch + identity tiers).
//
//   node scripts/backtraceConversions.js --measure   # size the candidate set (no writes, no shipment)
//   node scripts/backtraceConversions.js             # preview: snapshot + BEFORE stats, no writes
//   node scripts/backtraceConversions.js --apply     # reset + backtrace candidates + diff (reversible)
//   node scripts/backtraceConversions.js --restore /tmp/backtrace_snapshot_XXX.json   # undo
require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const ClickLog = require("../models/ClickLog");
const ProductFamily = require("../models/ProductFamily");
require("../models/User");
const { getOrders } = require("../utils/mercadoLibreOrders");
const { correlateOrders } = require("../utils/conversionCorrelation");

const SELLER = "482595248";
const WINDOW_MS = 168 * 60 * 60 * 1000; // 7 days (MAX_CORRELATION_HOURS)
const APPLY = process.argv.includes("--apply");
const MEASURE = process.argv.includes("--measure");
const RESTORE = process.argv.includes("--restore") ? process.argv[process.argv.indexOf("--restore") + 1] : null;

const CONV_FIELDS = [
  "convertedAt", "correlatedOrderId", "correlationConfidence", "correlationMethod",
  "correlationCertainty", "correlationUndisputed", "ventaIndirecta", "attributionReason",
  "matchDetails", "conversionData",
];

async function stats() {
  const conv = await ClickLog.find({ converted: true })
    .select("clickId correlationCertainty correlationConfidence ventaIndirecta conversionData.totalAmount")
    .lean();
  const byTier = {};
  let revenue = 0, orphans = 0, indirect = 0;
  for (const c of conv) {
    const k = c.correlationCertainty != null ? `${c.correlationCertainty}%` : (c.correlationConfidence || "legacy");
    byTier[k] = (byTier[k] || 0) + 1;
    revenue += c.conversionData?.totalAmount || 0;
    if (String(c.clickId || "").startsWith("orphan-")) orphans++;
    if (c.ventaIndirecta) indirect++;
  }
  const ordered = Object.fromEntries(Object.entries(byTier).sort((a, b) => (parseInt(b[0]) || -1) - (parseInt(a[0]) || -1)));
  return { conversions: conv.length, orphans, ventasIndirectas: indirect, revenue: Math.round(revenue), byTier: ordered };
}

// The date range holds ~88k orders and ML caps offset at 10k, so a single
// date_desc sweep only reaches the most recent ~25 days. Instead we WEEK-CHUNK
// the whole click era (each week is well under the cap) and, while paging, keep
// ONLY orders whose item is one of OUR tracked ML items (shrinks 88k → a few
// hundred). Returns the kept paid orders + the itemId→products map.
async function fetchOurPaidOrders() {
  const fams = await ProductFamily.find({ "mlItemIds.0": { $exists: true } }).select("_id mlItemIds").lean();
  const itemToProducts = new Map();
  const ourItems = new Set();
  for (const f of fams) for (const id of f.mlItemIds || []) {
    ourItems.add(id);
    if (!itemToProducts.has(id)) itemToProducts.set(id, new Set());
    itemToProducts.get(id).add(String(f._id));
  }
  const earliest = await ClickLog.findOne({ clicked: true }).sort({ clickedAt: 1 }).lean();
  const start = new Date(earliest.clickedAt); start.setUTCHours(0, 0, 0, 0);
  const end = Date.now();
  const WEEK = 7 * 24 * 3600 * 1000;
  console.log(`FETCH (weekly chunks) ${new Date(start).toISOString().slice(0, 10)} → ${new Date(end).toISOString().slice(0, 10)}, keeping only our ${ourItems.size} tracked items`);
  const kept = [];
  let scanned = 0, windows = 0;
  for (let ws = start.getTime(); ws < end; ws += WEEK) {
    windows++;
    const wsIso = new Date(ws).toISOString().replace("Z", "-00:00");
    const weIso = new Date(Math.min(ws + WEEK, end)).toISOString().replace("Z", "-00:00");
    let offset = 0;
    for (let page = 0; page < 220; page++) {
      const r = await getOrders(SELLER, { dateFrom: wsIso, dateTo: weIso, limit: 50, offset, sort: "date_asc" });
      if (!r.success || !r.orders?.length) break;
      scanned += r.orders.length;
      for (const o of r.orders) {
        if (o.status !== "paid") continue;
        const itemIds = (o.order_items || []).map((i) => i.item?.id).filter(Boolean);
        if (itemIds.some((id) => ourItems.has(id))) kept.push(o);
      }
      if (r.orders.length < 50) break;
      offset += 50;
      if (offset >= 10000) { console.log(`\n  (week ${wsIso.slice(0, 10)} exceeded 10k — rare spike, tail skipped)`); break; }
    }
    process.stdout.write(`\r  week ${windows} ${new Date(ws).toISOString().slice(0, 10)} | scanned ${scanned} | kept ${kept.length}   `);
  }
  console.log(`\n  scanned ${scanned} orders over ${windows} weeks; kept ${kept.length} for our products`);
  return { kept, itemToProducts };
}

// Given kept orders + itemId→products map, return orders that have a click on the
// mapped product within the 7-day window before the order.
async function selectCandidates(paidOrders, itemToProducts) {
  const clicks = await ClickLog.find({ clicked: true, productId: { $ne: null } }).select("productId clickedAt").lean();
  const clicksByProduct = new Map();
  for (const c of clicks) {
    const p = String(c.productId);
    if (!clicksByProduct.has(p)) clicksByProduct.set(p, []);
    clicksByProduct.get(p).push(new Date(c.clickedAt).getTime());
  }
  let productMapped = 0;
  const candidates = [];
  for (const o of paidOrders) {
    const itemIds = (o.order_items || []).map((i) => i.item?.id).filter(Boolean);
    const pids = new Set();
    for (const id of itemIds) for (const p of itemToProducts.get(id) || []) pids.add(p);
    if (!pids.size) continue;
    productMapped++;
    const od = new Date(o.date_created || o.orderDate).getTime();
    let hasClick = false;
    for (const p of pids) {
      for (const t of clicksByProduct.get(p) || []) { if (t >= od - WINDOW_MS && t <= od) { hasClick = true; break; } }
      if (hasClick) break;
    }
    if (hasClick) candidates.push(o);
  }
  return { candidates, productMapped, totalPaid: paidOrders.length };
}

async function restore(path) {
  const docs = JSON.parse(fs.readFileSync(path, "utf8"));
  console.log(`RESTORE from ${path}: ${docs.length} snapshot docs`);
  const del = await ClickLog.deleteMany({ clickId: /^orphan-/ });
  await ClickLog.updateMany({ converted: true }, { $set: { converted: false }, $unset: Object.fromEntries(CONV_FIELDS.map((f) => [f, ""])) });
  let orphansIns = 0, realRestored = 0;
  for (const d of docs) {
    if (String(d.clickId || "").startsWith("orphan-")) {
      delete d.__v;
      await ClickLog.updateOne({ _id: d._id }, { $set: d }, { upsert: true });
      orphansIns++;
    } else {
      const set = { converted: !!d.converted };
      for (const f of CONV_FIELDS) if (d[f] !== undefined) set[f] = d[f];
      await ClickLog.updateOne({ _id: d._id }, { $set: set });
      realRestored++;
    }
  }
  console.log(`  removed ${del.deletedCount} live orphans; restored ${orphansIns} snapshot orphans + ${realRestored} real clicks`);
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  if (RESTORE) { await restore(RESTORE); await mongoose.disconnect(); return; }

  if (MEASURE) {
    const { kept, itemToProducts } = await fetchOurPaidOrders();
    const { candidates } = await selectCandidates(kept, itemToProducts);
    console.log(`\nMEASURE:`);
    console.log(`  paid orders for OUR products: ${kept.length}`);
    console.log(`  → AND have a click on that product in 7d window (CANDIDATES): ${candidates.length}`);
    console.log(`  est. correlate time @2.5s/candidate: ~${Math.round(candidates.length * 2.5 / 60)} min`);
    await mongoose.disconnect();
    return;
  }

  // PHASE 0 — snapshot + BEFORE
  const before = await stats();
  const snapDocs = await ClickLog.find({ $or: [{ converted: true }, { clickId: /^orphan-/ }] }).lean();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapPath = `/tmp/backtrace_snapshot_${stamp}.json`;
  fs.writeFileSync(snapPath, JSON.stringify(snapDocs));
  console.log(`SNAPSHOT: ${snapDocs.length} docs → ${snapPath}`);
  console.log("BEFORE:", JSON.stringify(before, null, 1));

  if (!APPLY) {
    console.log(`\n(preview only — nothing written. Re-run with --apply to reset + backtrace.)`);
    console.log(`Undo later with: node scripts/backtraceConversions.js --restore ${snapPath}`);
    await mongoose.disconnect();
    return;
  }

  // PHASE 1 — fetch our-product orders + select candidates (cheap, no shipment).
  // Done BEFORE the reset so the live Conversions dashboard stays intact during
  // the ~15-min scan; it only goes empty during the correlate phase below.
  const { kept, itemToProducts } = await fetchOurPaidOrders();
  const { candidates } = await selectCandidates(kept, itemToProducts);
  console.log(`CANDIDATES: ${candidates.length} of ${kept.length} our-product paid orders — only these get the shipment fetch`);

  // PHASE 2 — reset (reversible via snapshot)
  const delOrphan = await ClickLog.deleteMany({ clickId: /^orphan-/ });
  const reset = await ClickLog.updateMany(
    { converted: true },
    { $set: { converted: false }, $unset: Object.fromEntries(CONV_FIELDS.map((f) => [f, ""])) }
  );
  console.log(`RESET: deleted ${delOrphan.deletedCount} orphans, cleared ${reset.modifiedCount} real clicks`);

  // PHASE 3 — correlate candidates fresh
  const res = await correlateOrders(candidates, SELLER, (p, m) => { if (p % 10 === 0 || p === candidates.length) process.stdout.write(`\r  correlating ${p}/${candidates.length} (${m} matched)`); });
  console.log(`\nCORRELATION: ${res.correlated} new, ${res.alreadyCorrelated} already, ${res.noMatch} no-match, ${res.errors} errors`);

  // PHASE 4 — after + diff
  const after = await stats();
  console.log("\nAFTER:", JSON.stringify(after, null, 1));
  console.log(`\nDIFF  conversions ${before.conversions} → ${after.conversions}  (${after.conversions - before.conversions >= 0 ? "+" : ""}${after.conversions - before.conversions})`);
  console.log(`      revenue     $${before.revenue.toLocaleString()} → $${after.revenue.toLocaleString()}`);
  console.log(`      orphans     ${before.orphans} → ${after.orphans}   ventasIndirectas ${before.ventasIndirectas} → ${after.ventasIndirectas}`);
  console.log(`\nSnapshot (undo): node scripts/backtraceConversions.js --restore ${snapPath}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
