// scripts/backtraceVariations.js
//
// SAME-FAMILY VARIATION — ONLY for the LOOSE (city) tier: a lead clicked product A and
// bought a DIFFERENT product from the SAME family in the same city within 1h → 5%.
// (The zip tier stays EXACT-product only; there is NO zip same-family variation — city
// + broad family is coincidental for a popular category, so the window is tight (1h).)
//   • city==city + same-family (diff product) + ≤1h → 5%
// Family = category: confeccionada (reforzada + SIN REFUERZO merged, any size/color),
// rollo, borde, groundcover, complementos — each its own. borde ≠ groundcover.
// Requires a DIFFERENT exact product (exact-product is tiers 1/2). Overrides only a
// LOWER existing score.
//
//   node scripts/backtraceVariations.js [--apply]
require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const ClickLog = require("../models/ClickLog");
const User = require("../models/User");
const PF = require("../models/ProductFamily");
const ZipCode = require("../models/ZipCode");
const { getOrders, getShipmentById } = require("../utils/mercadoLibreOrders");

const SELLER = "482595248";
const APPLY = process.argv.includes("--apply");
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const normZip = (z) => String(z || "").replace(/\D/g, "");
const decay = (h) => (h <= 12 ? 85 : h <= 72 ? Math.round(85 - (75 * (h - 12)) / 60) : 0); // exact tier-2 curve

function familyKey(names) {
  const p = names.join(" > ").toLowerCase();
  if (/ground\s*cover|antimaleza/.test(p)) return "groundcover";
  if (/borde/.test(p)) return "borde";
  if (/\brollo\b/.test(p)) return "rollo";
  if (/confeccionada|reforzada|sin\s*refuerzo/.test(p)) return "confeccionada";
  if (/kit|ojillo|cord[oó]n|sujetador|complement/.test(p)) return "complementos";
  return names[0] || "otro";
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  // familyKey per product (climb ancestry once, cached)
  const allFams = await PF.find({}).select("name parentId").lean();
  const byId = new Map(allFams.map((f) => [String(f._id), f]));
  const fkCache = new Map();
  const fkOf = (pid) => {
    pid = String(pid);
    if (fkCache.has(pid)) return fkCache.get(pid);
    const names = []; let c = byId.get(pid), g = 0;
    while (c && g++ < 12) { names.unshift(c.name); c = c.parentId ? byId.get(String(c.parentId)) : null; }
    const k = familyKey(names); fkCache.set(pid, k); return k;
  };

  const zips = await ZipCode.find({}).select("code city municipality").lean();
  const zipToCity = new Map();
  for (const z of zips) zipToCity.set(normZip(z.code), norm(z.city || z.municipality));
  const cityOf = (city, zip) => norm(city) || zipToCity.get(normZip(zip)) || "";

  const fams = await PF.find({ "mlItemIds.0": { $exists: true } }).select("_id mlItemIds").lean();
  const itemToProduct = new Map();
  for (const f of fams) for (const id of f.mlItemIds || []) itemToProduct.set(id, String(f._id));

  // clicks → lead zip+city; index by FAMILY key
  const clicks = await ClickLog.find({ clicked: true, productId: { $ne: null } }).select("clickId psid productId clickedAt").lean();
  const psids = [...new Set(clicks.map((c) => c.psid).filter(Boolean))];
  const userByPsid = new Map();
  for (let i = 0; i < psids.length; i += 500) {
    const us = await User.find({ psid: { $in: psids.slice(i, i + 500) } }).select("psid location").lean();
    for (const u of us) userByPsid.set(u.psid, u);
  }
  const idx = new Map(); // familyKey → [{clickedAt, zip, city, productId, click}]
  for (const c of clicks) {
    const u = userByPsid.get(c.psid); const loc = u && u.location;
    const zip = normZip(loc && loc.zipcode); const city = cityOf(loc && loc.city, loc && loc.zipcode);
    if (!zip && !city) continue;
    const fk = fkOf(c.productId);
    if (!idx.has(fk)) idx.set(fk, []);
    idx.get(fk).push({ clickedAt: new Date(c.clickedAt).getTime(), zip, city, productId: String(c.productId), click: c });
  }

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
    const ourPids = new Set();
    for (const it of o.order_items || []) { const p = itemToProduct.get(it.item?.id); if (p) ourPids.add(p); }
    if (!ourPids.size) continue;
    const orderFams = new Set([...ourPids].map(fkOf));
    // same-family clicks, DIFFERENT exact product, within 3h (the ONLY same-family
    // variation is the LOOSE city tier — the zip tier stays exact-product only).
    let pool = [];
    for (const fk of orderFams) for (const c of idx.get(fk) || []) if (!ourPids.has(c.productId) && c.clickedAt <= od && od - c.clickedAt <= 1 * 3600000) pool.push(c);
    if (!pool.length) continue;
    candidates++;
    let shipCity = null;
    if (o.shipping?.id) { const r = await getShipmentById(SELLER, o.shipping.id); shipFetched++; if (r.success) shipCity = cityOf(r.shipment.receiverAddress?.city, normZip(r.shipment.receiverAddress?.zipCode)); }
    await new Promise((r) => setTimeout(r, 120));
    // city + same-family (diff product) + ≤1h → 5%. No zip variation.
    let best = null;
    for (const c of pool) {
      const h = (od - c.clickedAt) / 3600000;
      if (shipCity && c.city && shipCity === c.city && h <= 1 && (!best || 5 > best.pct)) best = { c, pct: 5, method: "city_family", hours: Math.round(h) };
    }
    if (!best) continue;
    const ex = existingByOrder.get(oid);
    if (ex && ex.cert >= best.pct) continue;
    hits.push({ orderId: oid, clickId: best.c.click.clickId, clickDocId: best.c.click._id, method: best.method, hours: best.hours, pct: best.pct, family: [...orderFams][0], overrides: ex || null });
  }
  console.log(`\ncandidates (same-family diff-product, click ≤72h): ${candidates} | shipments fetched: ${shipFetched}`);
  console.log(`VARIATION HITS: ${hits.length}`);
  for (const h of hits.slice(0, 20)) console.log(`  order ${h.orderId} ← click ${h.clickId} | ${h.family} | ${h.method} +${h.hours}h | ${h.pct}%${h.overrides ? ` (overrides ${h.overrides.cert}%)` : ""}`);

  if (APPLY && hits.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(`/tmp/variation_apply_${stamp}.json`, JSON.stringify(hits));
    for (const h of hits) {
      if (h.overrides) await ClickLog.findByIdAndUpdate(h.overrides.docId, { converted: false, correlatedOrderId: null, correlationCertainty: null, correlationMethod: null, attributionReason: null, ventaIndirecta: false });
      await ClickLog.findByIdAndUpdate(h.clickDocId, {
        converted: true, convertedAt: new Date(), correlatedOrderId: h.orderId,
        correlationMethod: h.method, correlationCertainty: h.pct, ventaIndirecta: true,
        attributionReason: `${h.method === "zip_family" ? "cp" : "ciudad"} + MISMA FAMILIA (otro producto), ${h.hours}h post-click → ${h.pct}%`,
      });
    }
    console.log(`\nAPPLIED ${hits.length} variation attributions (backup /tmp/variation_apply_${stamp}.json)`);
  } else if (hits.length) console.log(`\n(dry run — pass --apply to write)`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
