// scripts/backtraceTier100.js
//
// TOP tier — 100% UNDISPUTED, never overridden (and overrides anything lower). ALL of:
//   • Meta name resembles the ML buyer nickname (nameInNickname)
//   • zip match (lead zip == ML shipping zip)
//   • product match (exact: order item ∈ ProductFamily(click.productId).mlItemIds)
//   • within a 96h window (click → sale) — for consistency, not because time is decisive
//
//   node scripts/backtraceTier100.js [--apply]
require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const ClickLog = require("../models/ClickLog");
const User = require("../models/User");
const PF = require("../models/ProductFamily");
const { getOrders, getShipmentById } = require("../utils/mercadoLibreOrders");

const SELLER = "482595248";
const APPLY = process.argv.includes("--apply");
const H96 = 96 * 3600 * 1000;
const normZip = (z) => String(z || "").replace(/\D/g, "");
const normName = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const nameInNickname = (first, nick) => { first = normName(first); const n = normName(nick); return !!(first && first.length >= 3 && n.includes(first)); };

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  const fams = await PF.find({ "mlItemIds.0": { $exists: true } }).select("_id mlItemIds").lean();
  const itemToProduct = new Map();
  for (const f of fams) for (const id of f.mlItemIds || []) itemToProduct.set(id, String(f._id));

  // clicks → lead first_name + zip; index by productId. Only leads WITH a name qualify.
  const clicks = await ClickLog.find({ clicked: true, productId: { $ne: null } }).select("clickId psid productId clickedAt").lean();
  const psids = [...new Set(clicks.map((c) => c.psid).filter(Boolean))];
  const uByPsid = new Map();
  for (let i = 0; i < psids.length; i += 500) {
    const us = await User.find({ psid: { $in: psids.slice(i, i + 500) } }).select("psid first_name location.zipcode").lean();
    for (const u of us) uByPsid.set(u.psid, u);
  }
  const idx = new Map();
  let usable = 0;
  for (const c of clicks) {
    const u = uByPsid.get(c.psid); const name = u && (u.first_name || "").trim(); const zip = normZip(u && u.location && u.location.zipcode);
    if (!name || !zip) continue; usable++;
    const p = String(c.productId); if (!idx.has(p)) idx.set(p, []);
    idx.get(p).push({ clickedAt: new Date(c.clickedAt).getTime(), zip, name, click: c });
  }
  console.log(`clicks w/ product + lead name + zip: ${usable} across ${idx.size} products`);

  const existingByOrder = new Map();
  for (const c of await ClickLog.find({ converted: true }).select("_id correlatedOrderId conversionData.orderId correlationCertainty").lean())
    for (const oid of [c.correlatedOrderId, c.conversionData?.orderId].filter(Boolean)) existingByOrder.set(String(oid), { docId: c._id, cert: c.correlationCertainty || 0 });

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
    const oid = String(o.id), od = new Date(o.date_created).getTime();
    const nick = o.buyer?.nickname || "";
    const pids = new Set();
    for (const it of o.order_items || []) { const p = itemToProduct.get(it.item?.id); if (p) pids.add(p); }
    if (!pids.size) continue;
    // clicks on this exact product within 96h whose lead name is IN the buyer nickname
    let pool = [];
    for (const p of pids) for (const c of idx.get(p) || []) if (c.clickedAt <= od && od - c.clickedAt <= H96 && nameInNickname(c.name, nick)) pool.push(c);
    if (!pool.length) continue;
    candidates++;
    let shipZip = null;
    if (o.shipping?.id) { const r = await getShipmentById(SELLER, o.shipping.id); shipFetched++; if (r.success) shipZip = normZip(r.shipment.receiverAddress?.zipCode); }
    await new Promise((r) => setTimeout(r, 120));
    const c = pool.find((x) => shipZip && x.zip === shipZip); // zip must also match
    if (!c) continue;
    const ex = existingByOrder.get(oid);
    hits.push({ orderId: oid, clickId: c.click.clickId, clickDocId: c.click._id, name: c.name, nick, zip: shipZip, hours: Math.round((od - c.clickedAt) / 3600000), overrides: (ex && ex.cert < 100) ? ex : null });
  }
  console.log(`\ncandidates (name-in-nick + product + ≤96h): ${candidates} | shipments fetched: ${shipFetched}`);
  console.log(`TIER-100 HITS (name+zip+product, undisputed): ${hits.length}`);
  for (const h of hits) console.log(`  order ${h.orderId} ← click ${h.clickId} | "${h.name}" in nick "${h.nick}" | zip ${h.zip} | +${h.hours}h${h.overrides ? ` (overrides ${h.overrides.cert}%)` : ""}`);

  if (APPLY && hits.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(`/tmp/tier100_apply_${stamp}.json`, JSON.stringify(hits));
    for (const h of hits) {
      if (h.overrides) await ClickLog.findByIdAndUpdate(h.overrides.docId, { converted: false, correlatedOrderId: null, correlationCertainty: null, correlationMethod: null, attributionReason: null, ventaIndirecta: false });
      await ClickLog.findByIdAndUpdate(h.clickDocId, {
        converted: true, convertedAt: new Date(), correlatedOrderId: h.orderId,
        correlationMethod: "name_zip_product", correlationCertainty: 100, correlationUndisputed: true, ventaIndirecta: false,
        attributionReason: `nombre (meta↔nick) + cp + producto, ${h.hours}h → 100% indiscutible`,
      });
    }
    console.log(`\nAPPLIED ${hits.length} tier-100 attributions (backup /tmp/tier100_apply_${stamp}.json)`);
  } else if (hits.length) console.log(`\n(dry run — pass --apply to write)`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
