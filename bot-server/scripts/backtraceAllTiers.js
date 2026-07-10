// scripts/backtraceAllTiers.js
//
// FULL-history re-correlation with the NEW tiered model (highest tier wins per order).
// Iterates every paid ML order in the click era; for orders that match a lead's click
// it fetches the shipment (city/zip) once and scores:
//   • 100 name_zip_product  — Meta name in ML nickname + zip match + EXACT product + ≤96h (UNDISPUTED)
//   •  ≤85 zip_product_time  — zip match + EXACT product + ≤72h, 85→10 linear (decay)
//   •  10 city_product_48h   — city match + EXACT product + ≤48h
//   •   5 city_family        — city match + SAME FAMILY (different product) + ≤1h
// Snapshots + resets current conversions first (reversible), then applies the best per order.
//
//   node scripts/backtraceAllTiers.js            # snapshot + reset + correlate + APPLY
//   node scripts/backtraceAllTiers.js --restore /tmp/alltiers_snapshot_XXX.json
require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const ClickLog = require("../models/ClickLog");
const User = require("../models/User");
const PF = require("../models/ProductFamily");
const ZipCode = require("../models/ZipCode");
const { getOrders, getShipmentById } = require("../utils/mercadoLibreOrders");

const SELLER = "482595248";
const RESTORE = process.argv.includes("--restore") ? process.argv[process.argv.indexOf("--restore") + 1] : null;
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const normZip = (z) => String(z || "").replace(/\D/g, "");
const normName = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const nameInNick = (first, nick) => { first = normName(first); const n = normName(nick); return !!(first && first.length >= 3 && n.includes(first)); };
const decay = (h) => (h <= 12 ? 85 : h <= 72 ? Math.round(85 - (75 * (h - 12)) / 60) : 0);
function familyKey(names) {
  const p = names.join(" > ").toLowerCase();
  if (/ground\s*cover|antimaleza/.test(p)) return "groundcover";
  if (/borde/.test(p)) return "borde";
  if (/\brollo\b/.test(p)) return "rollo";
  if (/confeccionada|reforzada|sin\s*refuerzo/.test(p)) return "confeccionada";
  if (/kit|ojillo|cord[oó]n|sujetador|complement/.test(p)) return "complementos";
  return names[0] || "otro";
}
const CONV_FIELDS = ["convertedAt", "correlatedOrderId", "correlationConfidence", "correlationMethod", "correlationCertainty", "correlationUndisputed", "ventaIndirecta", "attributionReason", "matchDetails", "conversionData"];

async function restore(path) {
  const docs = JSON.parse(fs.readFileSync(path, "utf8"));
  await ClickLog.deleteMany({ clickId: /^orphan-/ });
  await ClickLog.updateMany({ converted: true }, { $set: { converted: false }, $unset: Object.fromEntries(CONV_FIELDS.map((f) => [f, ""])) });
  let n = 0;
  for (const d of docs) { const set = { converted: !!d.converted }; for (const f of CONV_FIELDS) if (d[f] !== undefined) set[f] = d[f]; await ClickLog.updateOne({ _id: d._id }, { $set: set }); n++; }
  console.log(`restored ${n} docs from ${path}`);
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  if (RESTORE) { await restore(RESTORE); await mongoose.disconnect(); return; }

  // snapshot + reset
  const snap = await ClickLog.find({ converted: true }).lean();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapPath = `/tmp/alltiers_snapshot_${stamp}.json`;
  fs.writeFileSync(snapPath, JSON.stringify(snap));
  console.log(`SNAPSHOT ${snap.length} conversions → ${snapPath}`);
  await ClickLog.updateMany({ converted: true }, { $set: { converted: false }, $unset: Object.fromEntries(CONV_FIELDS.map((f) => [f, ""])) });

  // maps
  const allFams = await PF.find({}).select("name parentId mlItemIds").lean();
  const byId = new Map(allFams.map((f) => [String(f._id), f]));
  const fkCache = new Map();
  const fkOf = (pid) => { pid = String(pid); if (fkCache.has(pid)) return fkCache.get(pid); const names = []; let c = byId.get(pid), g = 0; while (c && g++ < 12) { names.unshift(c.name); c = c.parentId ? byId.get(String(c.parentId)) : null; } const k = familyKey(names); fkCache.set(pid, k); return k; };
  const itemToProduct = new Map(); const ourItems = new Set();
  for (const f of allFams) for (const id of f.mlItemIds || []) { itemToProduct.set(id, String(f._id)); ourItems.add(id); }
  const zips = await ZipCode.find({}).select("code city municipality").lean();
  const zipToCity = new Map(); for (const z of zips) zipToCity.set(normZip(z.code), norm(z.city || z.municipality));
  const cityOf = (city, zip) => norm(city) || zipToCity.get(normZip(zip)) || "";

  // clicks + lead identity, indexed by exact product and by family
  const clicks = await ClickLog.find({ clicked: true, productId: { $ne: null } }).select("clickId psid productId clickedAt").lean();
  const psids = [...new Set(clicks.map((c) => c.psid).filter(Boolean))];
  const uByPsid = new Map();
  for (let i = 0; i < psids.length; i += 500) { const us = await User.find({ psid: { $in: psids.slice(i, i + 500) } }).select("psid first_name location").lean(); for (const u of us) uByPsid.set(u.psid, u); }
  const byProduct = new Map(), byFamily = new Map();
  for (const c of clicks) {
    const u = uByPsid.get(c.psid); const loc = u && u.location;
    const e = { t: new Date(c.clickedAt).getTime(), zip: normZip(loc && loc.zipcode), city: cityOf(loc && loc.city, loc && loc.zipcode), name: (u && u.first_name || "").trim(), productId: String(c.productId), _id: c._id, clickId: c.clickId };
    const p = String(c.productId); if (!byProduct.has(p)) byProduct.set(p, []); byProduct.get(p).push(e);
    const fk = fkOf(c.productId); if (!byFamily.has(fk)) byFamily.set(fk, []); byFamily.get(fk).push(e);
  }
  console.log(`clicks indexed: ${clicks.length}`);

  // fetch all orders (weekly chunks, keep only our-product paid orders)
  const earliest = await ClickLog.findOne({ clicked: true }).sort({ clickedAt: 1 }).lean();
  const start = new Date(earliest.clickedAt); start.setUTCHours(0, 0, 0, 0);
  const end = Date.now(), WEEK = 7 * 24 * 3600 * 1000;
  const kept = []; let scanned = 0, wk = 0;
  for (let ws = start.getTime(); ws < end; ws += WEEK) {
    wk++; const wsIso = new Date(ws).toISOString().replace("Z", "-00:00"), weIso = new Date(Math.min(ws + WEEK, end)).toISOString().replace("Z", "-00:00");
    let offset = 0;
    for (let page = 0; page < 220; page++) {
      const r = await getOrders(SELLER, { dateFrom: wsIso, dateTo: weIso, limit: 50, offset, sort: "date_asc" });
      if (!r.success || !r.orders?.length) break; scanned += r.orders.length;
      for (const o of r.orders) { if (o.status !== "paid") continue; const ids = (o.order_items || []).map((i) => i.item?.id).filter(Boolean); if (ids.some((id) => ourItems.has(id))) kept.push(o); }
      if (r.orders.length < 50) break; offset += 50; if (offset >= 10000) break;
    }
    process.stdout.write(`\r  wk${wk} ${new Date(ws).toISOString().slice(0, 10)} scanned ${scanned} kept ${kept.length}   `);
  }
  console.log(`\nscanned ${scanned}; kept ${kept.length} our-product paid orders`);

  // score each order → best tier
  const hits = []; let shipFetched = 0;
  for (const o of kept) {
    const oid = String(o.id), od = new Date(o.date_created).getTime(), nick = o.buyer?.nickname || "";
    const ourPids = new Set(); for (const it of o.order_items || []) { const p = itemToProduct.get(it.item?.id); if (p) ourPids.add(p); }
    if (!ourPids.size) continue;
    const fams = new Set([...ourPids].map(fkOf));
    // gather candidate clicks (exact within 96h, or same-family diff-product within 1h)
    const cands = [];
    for (const p of ourPids) for (const e of byProduct.get(p) || []) { const h = (od - e.t) / 3600000; if (e.t <= od && h <= 96) cands.push({ e, h, exact: true }); }
    for (const fk of fams) for (const e of byFamily.get(fk) || []) { if (ourPids.has(e.productId)) continue; const h = (od - e.t) / 3600000; if (e.t <= od && h <= 1) cands.push({ e, h, exact: false }); }
    if (!cands.length) continue;
    let shipZip = null, shipCity = null;
    if (o.shipping?.id) { const r = await getShipmentById(SELLER, o.shipping.id); shipFetched++; if (r.success) { shipZip = normZip(r.shipment.receiverAddress?.zipCode); shipCity = cityOf(r.shipment.receiverAddress?.city, shipZip); } }
    await new Promise((r) => setTimeout(r, 110));
    let best = null;
    for (const { e, h, exact } of cands) {
      const zipM = !!(e.zip && shipZip && e.zip === shipZip), cityM = !!(e.city && shipCity && e.city === shipCity);
      let s = null;
      if (exact) {
        if (nameInNick(e.name, nick) && zipM && h <= 96) s = { pct: 100, method: "name_zip_product", undisputed: true, indirect: false, reason: `nombre + cp + producto, ${Math.round(h)}h → 100% indiscutible` };
        else if (zipM && h <= 72) { const p = decay(h); s = { pct: p, method: "zip_product_time", undisputed: false, indirect: false, reason: `cp + producto, ${Math.round(h)}h → ${p}%` }; }
        else if (cityM && h <= 48) s = { pct: 10, method: "city_product_48h", undisputed: false, indirect: true, reason: `ciudad + producto ≤48h → 10%` };
      } else {
        if (cityM && h <= 1) s = { pct: 5, method: "city_family", undisputed: false, indirect: true, reason: `ciudad + misma familia (otro producto) ≤1h → 5%` };
      }
      if (s && (!best || s.pct > best.s.pct)) best = { e, h, s };
    }
    if (best) hits.push({ orderId: oid, e: best.e, s: best.s, amount: o.total_amount, orderDate: new Date(o.date_created), nick, item: (o.order_items?.[0]?.item?.title) || null });
  }
  console.log(`\nshipments fetched: ${shipFetched} | TOTAL ATTRIBUTIONS: ${hits.length}`);
  const dist = {}; for (const h of hits) dist[h.s.pct + "%"] = (dist[h.s.pct + "%"] || 0) + 1;
  console.log("distribution:", JSON.stringify(dist));

  // apply (dedup: one click per order; if a click already used, keep the higher-order... simple: last wins per click)
  const usedClick = new Set();
  let applied = 0;
  for (const h of hits.sort((a, b) => b.s.pct - a.s.pct)) {
    if (usedClick.has(String(h.e._id))) continue; usedClick.add(String(h.e._id));
    await ClickLog.findByIdAndUpdate(h.e._id, {
      converted: true, convertedAt: new Date(), correlatedOrderId: h.orderId,
      correlationMethod: h.s.method, correlationCertainty: h.s.pct, correlationUndisputed: !!h.s.undisputed, ventaIndirecta: !!h.s.indirect,
      attributionReason: h.s.reason,
      conversionData: { orderId: h.orderId, buyerNickname: h.nick, totalAmount: h.amount, orderDate: h.orderDate, itemTitle: h.item },
    });
    applied++;
  }
  console.log(`APPLIED ${applied} attributions. Restore: node scripts/backtraceAllTiers.js --restore ${snapPath}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
