// scripts/backtraceTier2.js
//
// TIER 2 (strong) — zip_product_time. An unclaimed (or lower-scored) paid ML sale of
// product A shipped to ZIP X, where a lead whose zip = X clicked product A, with the
// sale within 72h AFTER the click. Certainty: 85% for ≤12h, then LINEAR decay to 0 at
// 72h (pct = 85·(72−h)/60 for 12<h≤72). >72h → nothing. Overrides ONLY a lower score.
//
//   node scripts/backtraceTier2.js            # DRY — report hits
//   node scripts/backtraceTier2.js --apply     # write (override lower scores; backup first)
require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const ClickLog = require("../models/ClickLog");
const User = require("../models/User");
const PF = require("../models/ProductFamily");
const { getOrders, getShipmentById } = require("../utils/mercadoLibreOrders");

const SELLER = "482595248";
const APPLY = process.argv.includes("--apply");
const H72 = 72 * 3600 * 1000;
const normZip = (z) => String(z || "").replace(/\D/g, "");
// 85% for ≤12h; linear DOWN TO A FLOOR OF 10% at 72h (zip+72h == city+48h = 10%);
// nothing after 72h. pct = 85 − 75·(h−12)/60 for 12<h≤72.
const decay = (h) => (h <= 12 ? 85 : h <= 72 ? Math.round(85 - (75 * (h - 12)) / 60) : 0);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  const fams = await PF.find({ "mlItemIds.0": { $exists: true } }).select("_id mlItemIds").lean();
  const itemToProduct = new Map();
  for (const f of fams) for (const id of f.mlItemIds || []) itemToProduct.set(id, String(f._id));

  // clicks joined to lead ZIP; index by productId → [{clickedAt, zip, click}]
  const clicks = await ClickLog.find({ clicked: true, productId: { $ne: null } }).select("clickId psid productId clickedAt").lean();
  const psids = [...new Set(clicks.map((c) => c.psid).filter(Boolean))];
  const zipByPsid = new Map();
  for (let i = 0; i < psids.length; i += 500) {
    const us = await User.find({ psid: { $in: psids.slice(i, i + 500) } }).select("psid location.zipcode").lean();
    for (const u of us) { const z = normZip(u.location && u.location.zipcode); if (z) zipByPsid.set(u.psid, z); }
  }
  const idx = new Map();
  let withZip = 0;
  for (const c of clicks) {
    const zip = zipByPsid.get(c.psid); if (!zip) continue; withZip++;
    const p = String(c.productId); if (!idx.has(p)) idx.set(p, []);
    idx.get(p).push({ clickedAt: new Date(c.clickedAt).getTime(), zip, click: c });
  }
  console.log(`clicks w/ product & lead-zip: ${withZip} across ${idx.size} products`);

  // existing attributions per order (for override-by-higher)
  const existingByOrder = new Map();
  for (const c of await ClickLog.find({ converted: true }).select("_id correlatedOrderId conversionData.orderId correlationCertainty").lean()) {
    for (const oid of [c.correlatedOrderId, c.conversionData?.orderId].filter(Boolean)) existingByOrder.set(String(oid), { docId: c._id, cert: c.correlationCertainty || 0 });
  }

  // last 7 days orders
  const end = Date.now(), start = end - 7 * 24 * 3600 * 1000;
  const dateFrom = new Date(start).toISOString().replace("Z", "-00:00"), dateTo = new Date(end).toISOString().replace("Z", "-00:00");
  let orders = [], offset = 0;
  for (let page = 0; page < 220; page++) {
    const r = await getOrders(SELLER, { dateFrom, dateTo, limit: 50, offset, sort: "date_desc" });
    if (!r.success || !r.orders?.length) break;
    orders = orders.concat(r.orders); if (r.orders.length < 50) break; offset += 50;
  }
  const paid = orders.filter((o) => o.status === "paid");
  console.log(`orders last 7d: ${orders.length} (${paid.length} paid)`);

  const hits = []; let candidates = 0, shipFetched = 0;
  for (const o of paid) {
    const oid = String(o.id);
    const od = new Date(o.date_created).getTime();
    const pids = new Set();
    for (const it of o.order_items || []) { const p = itemToProduct.get(it.item?.id); if (p) pids.add(p); }
    if (!pids.size) continue;
    // best click on this product within 72h before the order
    let best = null;
    for (const p of pids) for (const c of idx.get(p) || []) {
      if (c.clickedAt <= od && od - c.clickedAt <= H72) { if (!best || c.clickedAt > best.clickedAt) best = c; }
    }
    if (!best) continue;
    candidates++;
    let shipZip = null;
    if (o.shipping?.id) { const r = await getShipmentById(SELLER, o.shipping.id); shipFetched++; if (r.success) shipZip = normZip(r.shipment.receiverAddress?.zipCode); }
    await new Promise((r) => setTimeout(r, 120));
    if (!shipZip || shipZip !== best.zip) continue; // EXACT zip match required
    const h = (od - best.clickedAt) / 3600000;
    const pct = decay(h);
    if (pct <= 0) continue;
    const ex = existingByOrder.get(oid);
    if (ex && ex.cert >= pct) continue; // override only a LOWER score
    hits.push({ orderId: oid, clickId: best.click.clickId, clickDocId: best.click._id, zip: shipZip, hours: Math.round(h), pct, overrides: ex ? ex : null });
  }
  console.log(`\ncandidates (product + click ≤72h): ${candidates} | shipments fetched: ${shipFetched}`);
  console.log(`TIER-2 HITS (zip+product, ≤72h decay): ${hits.length}`);
  for (const h of hits.slice(0, 20)) console.log(`  order ${h.orderId} ← click ${h.clickId} | zip ${h.zip} | +${h.hours}h | ${h.pct}%${h.overrides ? ` (overrides ${h.overrides.cert}%)` : ""}`);

  if (APPLY && hits.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(`/tmp/tier2_apply_${stamp}.json`, JSON.stringify(hits));
    for (const h of hits) {
      if (h.overrides) await ClickLog.findByIdAndUpdate(h.overrides.docId, { converted: false, correlatedOrderId: null, correlationCertainty: null, correlationMethod: null, attributionReason: null, ventaIndirecta: false });
      await ClickLog.findByIdAndUpdate(h.clickDocId, {
        converted: true, convertedAt: new Date(), correlatedOrderId: h.orderId,
        correlationMethod: "zip_product_time", correlationCertainty: h.pct, ventaIndirecta: false,
        attributionReason: `cp + producto, ${h.hours}h post-click → ${h.pct}% (decae a 72h)`,
      });
    }
    console.log(`\nAPPLIED ${hits.length} tier-2 attributions (backup /tmp/tier2_apply_${stamp}.json)`);
  } else if (hits.length) console.log(`\n(dry run — pass --apply to write)`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
