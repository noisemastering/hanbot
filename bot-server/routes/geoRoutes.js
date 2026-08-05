// routes/geoRoutes.js
//
// Geographic aggregations for the map view. Per-state counts of sales (and, later,
// conversations) so the dashboard can render a Mexico choropleth. Read-only.
const express = require("express");
const router = express.Router();

// GET /geo/by-state?metric=sales  → [{ state, count }]
router.get("/by-state", async (req, res) => {
  try {
    const metric = req.query.metric === "conversations" ? "conversations" : "sales";
    let rows;
    if (metric === "sales") {
      const MLSale = require("../models/MLSale");
      rows = await MLSale.aggregate([
        { $match: { "shipping.state": { $nin: [null, ""] } } },
        { $group: { _id: "$shipping.state", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]);
    } else {
      // Conversations by state. location.state is only set on ~2% of users, but ~1900
      // have a zip — so DERIVE the state from the zip via the ZipCode table when the
      // stored state is missing (read-only, at query time). This lifts the map from
      // ~160 to ~1,900 conversations.
      const User = require("../models/User");
      const ZipCode = require("../models/ZipCode");
      const users = await User.find({
        $or: [{ "location.state": { $nin: [null, ""] } }, { "location.zipcode": { $nin: [null, ""] } }],
      }).select("location.state location.zipcode").lean();

      // Resolve all needed zips in one query (zip → state map).
      const zips = [...new Set(users.filter((u) => !u.location?.state && u.location?.zipcode)
        .map((u) => String(u.location.zipcode).padStart(5, "0")))];
      const zdocs = zips.length ? await ZipCode.find({ code: { $in: zips } }).select("code state").lean() : [];
      const zipToState = new Map(zdocs.map((z) => [z.code, z.state]));

      const tally = new Map();
      for (const u of users) {
        const state = u.location?.state || zipToState.get(String(u.location?.zipcode || "").padStart(5, "0"));
        if (!state) continue;
        tally.set(state, (tally.get(state) || 0) + 1);
      }
      rows = [...tally.entries()].map(([_id, count]) => ({ _id, count })).sort((a, b) => b.count - a.count);
    }
    res.json({ success: true, metric, data: rows.map((r) => ({ state: r._id, count: r.count })) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
