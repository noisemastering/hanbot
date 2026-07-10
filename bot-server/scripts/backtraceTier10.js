// scripts/backtraceTier10.js
//
// LOOSEST correlation tier (10%): an UNCLAIMED paid ML sale, shipped to the SAME
// city as a lead, of the SAME product that lead clicked, within 48h AFTER the
// click, with NO zip match (no stronger signal). Overridable later by a stronger tier.
//
// Window: last 7 days → today. Fetches each candidate order's shipment (city/zip)
// from ML — only for orders that already product+48h-match a click, so it's cheap.
//
//   node scripts/backtraceTier10.js            # DRY — report hit count, no writes
//   node scripts/backtraceTier10.js --apply    # write the 10% attributions (backup first)
require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const ClickLog = require("../models/ClickLog");
const User = require("../models/User");
const PF = require("../models/ProductFamily");
const { getOrders, getShipmentById } = require("../utils/mercadoLibreOrders");

const SELLER = "482595248";
const APPLY = process.argv.includes("--apply");
const H48 = 48 * 3600 * 1000;
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const normZip = (z) => String(z || "").replace(/\D/g, "");

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  // 0) zip → city (municipality). Most leads have a ZIP but no stored city, and a zip
  //    IS a city — so derive the city from the zip on BOTH sides (lead + order shipment),
  //    normalized to the same field, so "same city" actually compares.
  const ZipCode = require("../models/ZipCode");
  const zips = await ZipCode.find({}).select("code city municipality").lean();
  const zipToCity = new Map();
  for (const z of zips) zipToCity.set(normZip(z.code), norm(z.city || z.municipality));
  const cityOf = (city, zip) => norm(city) || zipToCity.get(normZip(zip)) || "";

  // 1) itemId → our productId (leaf family that carries that ML item)
  const fams = await PF.find({ "mlItemIds.0": { $exists: true } }).select("_id mlItemIds").lean();
  const itemToProduct = new Map();
  for (const f of fams) for (const id of f.mlItemIds || []) itemToProduct.set(id, String(f._id));

  // 2) clicks (clicked, product) joined to their user's CITY + zip; index by productId.
  //    Only clicks whose user has a city qualify for this city-based tier.
  const clicks = await ClickLog.find({ clicked: true, productId: { $ne: null }, converted: { $ne: true } })
    .select("clickId psid productId clickedAt").lean();
  const psids = [...new Set(clicks.map((c) => c.psid).filter(Boolean))];
  const userByPsid = new Map();
  for (let i = 0; i < psids.length; i += 500) {
    const us = await User.find({ psid: { $in: psids.slice(i, i + 500) } }).select("psid location").lean();
    for (const u of us) userByPsid.set(u.psid, u);
  }
  const clickIndex = new Map(); // productId → [{clickedAt, city, zip, click}]
  let clicksWithCity = 0;
  for (const c of clicks) {
    const u = userByPsid.get(c.psid);
    const city = cityOf(u && u.location && u.location.city, u && u.location && u.location.zipcode);
    if (!city) continue;
    clicksWithCity++;
    const p = String(c.productId);
    if (!clickIndex.has(p)) clickIndex.set(p, []);
    clickIndex.get(p).push({ clickedAt: new Date(c.clickedAt).getTime(), city, zip: normZip(u.location && u.location.zipcode), click: c });
  }
  console.log(`clicks w/ product & user-city: ${clicksWithCity} across ${clickIndex.size} products`);

  // 3) fetch last-week paid orders
  const end = Date.now();
  const start = end - 7 * 24 * 3600 * 1000;
  const dateFrom = new Date(start).toISOString().replace("Z", "-00:00");
  const dateTo = new Date(end).toISOString().replace("Z", "-00:00");
  let orders = [], offset = 0;
  for (let page = 0; page < 220; page++) {
    const r = await getOrders(SELLER, { dateFrom, dateTo, limit: 50, offset, sort: "date_desc" });
    if (!r.success || !r.orders?.length) break;
    orders = orders.concat(r.orders);
    if (r.orders.length < 50) break;
    offset += 50;
  }
  const paid = orders.filter((o) => o.status === "paid");
  console.log(`orders last 7d: ${orders.length} (${paid.length} paid)`);

  // 4) candidate: order product matches a click on the same product within 48h AFTER it
  const alreadyClaimed = new Set((await ClickLog.find({ converted: true }).select("conversionData.orderId correlatedOrderId").lean())
    .flatMap((c) => [c.correlatedOrderId, c.conversionData?.orderId]).filter(Boolean).map(String));

  const hits = [];
  let candidates = 0, shipFetched = 0;
  for (const o of paid) {
    const oid = String(o.id);
    if (alreadyClaimed.has(oid)) continue;
    const od = new Date(o.date_created).getTime();
    const pids = new Set();
    for (const it of o.order_items || []) { const p = itemToProduct.get(it.item?.id); if (p) pids.add(p); }
    if (!pids.size) continue;
    // find a click on that product within [od-48h, od]
    let best = null;
    for (const p of pids) for (const c of clickIndex.get(p) || []) {
      if (c.clickedAt <= od && od - c.clickedAt <= H48) { if (!best || c.clickedAt > best.clickedAt) best = c; }
    }
    if (!best) continue;
    candidates++;
    // fetch shipment → city + zip
    let shipCity = null, shipZip = null;
    if (o.shipping?.id) { const r = await getShipmentById(SELLER, o.shipping.id); shipFetched++; if (r.success) { shipZip = normZip(r.shipment.receiverAddress?.zipCode); shipCity = cityOf(r.shipment.receiverAddress?.city, shipZip); } }
    await new Promise((r) => setTimeout(r, 120));
    if (!shipCity) continue;
    const cityMatch = shipCity === best.city;
    const zipMatch = best.zip && shipZip && best.zip === shipZip;
    if (cityMatch && !zipMatch) hits.push({ orderId: oid, clickId: best.click.clickId, clickDocId: best.click._id, city: shipCity, hoursAfter: Math.round((od - best.clickedAt) / 3600000) });
  }
  console.log(`\ncandidates (product + click ≤48h): ${candidates} | shipments fetched: ${shipFetched}`);
  console.log(`TIER-10 HITS (city+product+48h, no zip): ${hits.length}`);
  for (const h of hits.slice(0, 15)) console.log(`  order ${h.orderId} ← click ${h.clickId} | ${h.city} | +${h.hoursAfter}h`);

  if (APPLY && hits.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(`/tmp/tier10_apply_${stamp}.json`, JSON.stringify(hits));
    for (const h of hits) {
      await ClickLog.findByIdAndUpdate(h.clickDocId, {
        converted: true, convertedAt: new Date(), correlatedOrderId: h.orderId,
        correlationMethod: "city_product_48h", correlationCertainty: 10, ventaIndirecta: true,
        attributionReason: `ciudad + producto ≤48h, sin cp → tentativa (10%)`,
      });
    }
    console.log(`\nAPPLIED ${hits.length} tier-10 attributions (backup /tmp/tier10_apply_${stamp}.json)`);
  } else if (hits.length) {
    console.log(`\n(dry run — pass --apply to write these ${hits.length} attributions)`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
