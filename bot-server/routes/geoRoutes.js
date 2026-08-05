// routes/geoRoutes.js
//
// Geographic aggregations for the map view — per-state counts of four metrics:
//   ml            all Mercado Libre orders          MLSale.shipping.state (100% present)
//   ventas        sales WE attributed to the bot    ConvoSaleMatch → MLSale.shipping.state
//   conversations chats with a known location       User.location.state (zip-derived if missing)
//   clicks        ad-link clicks                     ClickLog.psid → clicker's User state
// Read-only.
const express = require("express");
const router = express.Router();

const norm = (s) => String(s || "").padStart(5, "0");

// Resolve psid → state (short name), using the stored state or deriving it from the
// user's zip via the ZipCode table. Shared by the conversations + clicks metrics.
async function statesForPsids(psids) {
  const User = require("../models/User");
  const ZipCode = require("../models/ZipCode");
  const users = await User.find({ psid: { $in: psids } }).select("psid location.state location.zipcode").lean();
  const needZip = [...new Set(users.filter((u) => !u.location?.state && u.location?.zipcode).map((u) => norm(u.location.zipcode)))];
  const zdocs = needZip.length ? await ZipCode.find({ code: { $in: needZip } }).select("code state").lean() : [];
  const zmap = new Map(zdocs.map((z) => [z.code, z.state]));
  const map = new Map();
  for (const u of users) {
    const st = u.location?.state || zmap.get(norm(u.location?.zipcode));
    if (st) map.set(u.psid, st);
  }
  return map;
}

const toRows = (tally) =>
  [...tally.entries()].map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count);

// GET /geo/by-state?metric=ml|ventas|conversations|clicks
router.get("/by-state", async (req, res) => {
  try {
    const metric = ["ml", "ventas", "conversations", "clicks"].includes(req.query.metric) ? req.query.metric : "ml";
    let rows;

    if (metric === "ml") {
      const MLSale = require("../models/MLSale");
      const agg = await MLSale.aggregate([
        { $match: { "shipping.state": { $nin: [null, ""] } } },
        { $group: { _id: "$shipping.state", count: { $sum: 1 } } },
      ]);
      rows = toRows(new Map(agg.map((r) => [r._id, r.count])));

    } else if (metric === "ventas") {
      // Attributed conversions → the shipping state of each matched ML order.
      const ConvoSaleMatch = require("../models/ConvoSaleMatch");
      const MLSale = require("../models/MLSale");
      const orderIds = [...new Set((await ConvoSaleMatch.find({}).select("orderId").lean()).map((m) => String(m.orderId)))];
      const sales = orderIds.length
        ? await MLSale.find({ _id: { $in: orderIds } }).select("shipping.state").lean() : [];
      const tally = new Map();
      for (const s of sales) { const st = s.shipping?.state; if (st) tally.set(st, (tally.get(st) || 0) + 1); }
      rows = toRows(tally);

    } else if (metric === "conversations") {
      const User = require("../models/User");
      const psids = await User.distinct("psid", {
        $or: [{ "location.state": { $nin: [null, ""] } }, { "location.zipcode": { $nin: [null, ""] } }],
      });
      const stateMap = await statesForPsids(psids);
      const tally = new Map();
      for (const st of stateMap.values()) tally.set(st, (tally.get(st) || 0) + 1);
      rows = toRows(tally);

    } else { // clicks
      const ClickLog = require("../models/ClickLog");
      const perPsid = await ClickLog.aggregate([
        { $match: { psid: { $nin: [null, ""] } } },
        { $group: { _id: "$psid", n: { $sum: 1 } } },
      ]);
      const stateMap = await statesForPsids(perPsid.map((c) => c._id));
      const tally = new Map();
      for (const c of perPsid) { const st = stateMap.get(c._id); if (st) tally.set(st, (tally.get(st) || 0) + c.n); }
      rows = toRows(tally);
    }

    res.json({ success: true, metric, total: rows.reduce((a, r) => a + r.count, 0), data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
