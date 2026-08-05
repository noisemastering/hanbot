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
      // Conversations by state — via the User location the engine syncs.
      const User = require("../models/User");
      rows = await User.aggregate([
        { $match: { "location.state": { $nin: [null, ""] } } },
        { $group: { _id: "$location.state", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]);
    }
    res.json({ success: true, metric, data: rows.map((r) => ({ state: r._id, count: r.count })) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
