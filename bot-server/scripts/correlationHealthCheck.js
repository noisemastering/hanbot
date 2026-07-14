// scripts/correlationHealthCheck.js
//
// Repeatable "are we clean?" audit of the convo↔sale correlation collection. Checks
// every invariant the attribution rules promise and prints a PASS/FAIL report. Exits 0
// if everything is clean, 1 otherwise — so it can gate a deploy or be run on demand.
//
//   node scripts/correlationHealthCheck.js            # summary
//   node scripts/correlationHealthCheck.js --examples # + up to 5 offending ids per check
//
// It NEVER writes anything.
require("dotenv").config();
const mongoose = require("mongoose");

const SHOW = process.argv.includes("--examples");
const mxDay = (d) => new Date(new Date(d).getTime() - 6 * 3600e3).toISOString().slice(0, 10);
const nz = (z) => String(z || "").replace(/\D/g, "") || null;
const parseSize = (t) => {
  const m = String(t || "").toLowerCase().replace(/(\d),(\d)/g, "$1.$2").match(/(\d{1,2}(?:\.\d)?)\s*m?\s*[x×]\s*(\d{1,2}(?:\.\d)?)/);
  if (!m) return null;
  const a = +m[1], b = +m[2];
  if (!(a >= 1 && a <= 16 && b >= 1 && b <= 16)) return null;
  return `${Math.min(a, b)}x${Math.max(a, b)}`;
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const M = require("../models/ConvoSaleMatch");
  const ClickLog = require("../models/ClickLog");
  const Conversation = require("../models/Conversation");
  const ZipCode = require("../models/ZipCode");
  const SystemState = require("../models/SystemState");
  const { normalizeCity } = require("../utils/conversionCorrelation");
  const { looksLikeName } = require("../utils/convoSaleMatcher");

  const all = await M.find({}).lean();
  const active = all.filter((m) => m.humanVerdict !== "rejected");
  const sys = active.filter((m) => m.method !== "human" && m.orderId); // order-bearing system matches

  // preload clicks (days/times/sizes) + convo baskets + zip→state
  const psids = [...new Set(sys.map((m) => m.psid))];
  const clicksByPsid = new Map();
  for (const c of await ClickLog.find({ psid: { $in: psids } }).select("psid clicked clickedAt productName").lean()) {
    if (!clicksByPsid.has(c.psid)) clicksByPsid.set(c.psid, []);
    clicksByPsid.get(c.psid).push(c);
  }
  const basketByPsid = new Map();
  for (const cv of await Conversation.find({ psid: { $in: psids } }).select("psid itemsDiscussed").lean()) {
    basketByPsid.set(cv.psid, new Set((cv.itemsDiscussed || []).map((b) => b.askedAs).filter(Boolean)));
  }
  const zipToState = new Map();
  for (const z of await ZipCode.find({}).select("code state").lean().catch(() => [])) {
    const k = z.code ? String(z.code).replace(/\D/g, "").padStart(5, "0") : null;
    if (k && z.state) zipToState.set(k, String(z.state).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim());
  }
  const clickedSizesOf = (psid) => new Set((clicksByPsid.get(psid) || []).filter((c) => c.clicked).map((c) => parseSize(c.productName)).filter(Boolean));
  const poiOf = (psid) => new Set([...(basketByPsid.get(psid) || []), ...clickedSizesOf(psid)]);

  const checks = [];
  const check = (name, offenders) => checks.push({ name, fail: offenders.length, ex: offenders.slice(0, 5) });

  // 1. BIJECTION — each order → exactly one client
  const byOrder = {};
  for (const m of sys) (byOrder[m.orderId] = byOrder[m.orderId] || new Set()).add(m.psid);
  check("order → exactly one client", Object.entries(byOrder).filter(([, s]) => s.size > 1).map(([o]) => o));

  // 2. MULTI-ORDER CLIENT → every order ≥70% AND all the SAME buyer (one chat = one client)
  const bkey = (m) => { const s = m.sale || {}; return s.buyerId ? "id:" + s.buyerId : s.buyerNickname ? "nk:" + String(s.buyerNickname).toLowerCase().trim() : s.receiverName ? "rc:" + String(s.receiverName).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim() : "?:" + m.orderId; };
  const byPsid = {};
  for (const m of sys) (byPsid[m.psid] = byPsid[m.psid] || []).push(m);
  const multi = Object.entries(byPsid).filter(([, a]) => new Set(a.map((x) => x.orderId)).size > 1);
  check("multi-order client: all orders ≥70%", multi.filter(([, a]) => a.some((x) => (x.certainty ?? 100) < 70)).map(([p]) => p));
  check("multi-order client: all orders SAME buyer", multi.filter(([, a]) => new Set(a.map(bkey)).size > 1).map(([p, a]) => `${p} buyers=[${[...new Set(a.map((x) => x.sale?.buyerNickname || x.sale?.receiverName))].join(" | ")}]`));

  // 3. GATE — clicked link required
  check("assigned convo actually clicked a link",
    sys.filter((m) => !(clicksByPsid.get(m.psid) || []).some((c) => c.clicked && c.clickedAt)).map((m) => m._id));

  // 4. GATE — sale AFTER a same-day click (directional) + stored gap ≥ 0
  const dirBad = [], gapBad = [];
  for (const m of sys) {
    const saleT = m.sale && m.sale.dateCreated ? new Date(m.sale.dateCreated).getTime() : null;
    const clicked = (clicksByPsid.get(m.psid) || []).filter((c) => c.clicked && c.clickedAt);
    if (saleT != null && clicked.length) {
      const ok = clicked.some((c) => { const ct = new Date(c.clickedAt).getTime(); return mxDay(ct) === mxDay(saleT) && ct <= saleT; });
      if (!ok) dirBad.push(m._id);
    }
    if (m.matchDetails && m.matchDetails.gapHoursToSale != null && m.matchDetails.gapHoursToSale < 0) gapBad.push(m._id);
  }
  check("sale falls AFTER a same-day click (directional)", dirBad);
  check("stored gapHoursToSale ≥ 0", gapBad);

  // 5. CROSS-STATE — convo (zip's state) vs sale state must not differ when both known
  const stBad = [];
  for (const m of sys) {
    const d = m.matchDetails || {};
    const cs = nz(d.convoZip) && zipToState.get(nz(d.convoZip).padStart(5, "0"));
    const ss = (m.sale && m.sale.shippingState) || d.saleState;
    const ssN = ss ? String(ss).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim() : null;
    if (cs && ssN && cs !== ssN) stBad.push(`${m._id} ${cs}≠${ssN}`);
  }
  check("no cross-state assignment (zip state vs sale state)", stBad);

  // 6. SIGNAL CORRECTNESS
  const zipBad = [], cityBad = [], itemBad = [];
  for (const m of active) {
    const s = m.signals || {}, d = m.matchDetails || {};
    if (s.zip && nz(d.convoZip) && nz(d.saleZip) && nz(d.convoZip) !== nz(d.saleZip)) zipBad.push(m._id);
    if (s.city && d.convoCity && d.saleCity && normalizeCity(d.convoCity) !== normalizeCity(d.saleCity)) cityBad.push(m._id);
    if (s.item && m.method !== "human") {
      const saleSize = parseSize(m.sale && m.sale.itemTitle);
      if (saleSize && !poiOf(m.psid).has(saleSize)) itemBad.push(`${m._id} sold ${saleSize} ∉ poi`);
    }
  }
  check("zip signal ⇒ zips equal", zipBad);
  check("city signal ⇒ cities equal", cityBad);
  check("item signal ⇒ sold size ∈ discussed∪clicked", itemBad);

  // A name/nickname-based match must have a convo name that actually LOOKS like a name
  // (not a phrase the extractor mistook for one, e.g. "que tome bien las medidas").
  const nameGarbage = active
    .filter((m) => (m.signals?.name || m.signals?.nickname) && m.matchDetails?.convoName && !looksLikeName(m.matchDetails.convoName))
    .map((m) => `${m._id} name="${m.matchDetails.convoName}"`);
  check("name/nickname signal ⇒ convo name looks like a name", nameGarbage);

  // 7. reason% == certainty
  check("reason % matches certainty",
    active.filter((m) => { if (m.certainty == null) return false; const r = (m.reason || "").match(/\((\d{1,3})%\)/); return r && +r[1] !== m.certainty; }).map((m) => m._id));

  // 8. reason tier ↔ signals
  const tierBad = [];
  for (const m of active) {
    const r = m.reason || "", s = m.signals || {};
    if (/producto distinto/.test(r) && s.item) tierBad.push(`${m._id} distinto+item`);
    if (/\bcp\b/.test(r) && !s.zip) tierBad.push(`${m._id} cp-no-zip`);
    if (/ciudad/.test(r) && !s.city && !s.zip) tierBad.push(`${m._id} ciudad-no-loc`);
  }
  check("reason tier consistent with signals", tierBad);

  // 9. day-split integrity
  const dsBad = [];
  for (const m of active) {
    const d = m.matchDetails || {};
    if (Array.isArray(d.convoSizesOnDay) && Array.isArray(d.convoSizesOther) && Array.isArray(d.convoSizes)) {
      const u = new Set([...d.convoSizesOnDay, ...d.convoSizesOther]), c = new Set(d.convoSizes);
      if (u.size !== c.size || [...c].some((x) => !u.has(x))) dsBad.push(`${m._id} split≠sizes`);
      if (d.convoSizesOnDay.some((x) => d.convoSizesOther.includes(x))) dsBad.push(`${m._id} overlap`);
    }
  }
  check("day-split = onDay ∪ other, no overlap", dsBad);

  // 10. certainty ∈ multiples of 10 (or null for human)
  check("certainty is a multiple of 10 (or null=human)",
    active.filter((m) => m.certainty != null && (m.certainty < 0 || m.certainty > 100 || m.certainty % 10 !== 0)).map((m) => `${m._id}:${m.certainty}`));

  // 11. no null-certainty on a non-human match
  check("no null certainty on a system match",
    active.filter((m) => m.certainty == null && m.method !== "human").map((m) => m._id));

  // 12. reporting floor is a sane, persisted value
  const floor = (await SystemState.getState()).salesReportingFloorPct;
  check("reporting floor set (0–100, mult of 10)", Number.isFinite(floor) && floor >= 0 && floor <= 100 && floor % 10 === 0 ? [] : [`floor=${floor}`]);

  // ── report ──
  console.log(`\n  Correlation health check — ${new Date().toISOString()}`);
  console.log(`  matches: ${all.length} total · ${active.length} active · ${sys.length} order-bearing · reporting floor ${floor}%\n`);
  let failed = 0;
  for (const c of checks) {
    const ok = c.fail === 0;
    if (!ok) failed++;
    console.log(`  ${ok ? "✅" : "❌"} ${c.name}${ok ? "" : `  — ${c.fail} offending`}`);
    if (!ok && SHOW) c.ex.forEach((x) => console.log(`        ${x}`));
  }
  console.log(`\n  ${failed === 0 ? "🎉 ALL CLEAN" : `⚠️  ${failed} check(s) FAILED`} (${checks.length - failed}/${checks.length} passed)\n`);
  await mongoose.disconnect();
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error("health check error:", e); process.exit(1); });
