// routes/adSetsRoutes.js
const express = require("express");
const router = express.Router();
const AdSet = require("../models/AdSet");
const Campaign = require("../models/Campaign");

// Get all ad sets (optionally filter by campaign)
router.get("/", async (req, res) => {
  try {
    const { campaignId } = req.query;
    const filter = campaignId ? { campaignId } : {};

    const adSets = await AdSet.find(filter)
      .populate("campaignId", "name ref")
      .sort({ createdAt: -1 });

    res.json({ success: true, data: adSets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single ad set by ID
router.get("/:id", async (req, res) => {
  try {
    const adSet = await AdSet.findById(req.params.id)
      .populate("campaignId", "name ref");

    if (!adSet) {
      return res.status(404).json({ success: false, error: "AdSet no encontrado" });
    }

    res.json({ success: true, data: adSet });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get ad sets by campaign ID
router.get("/campaign/:campaignId", async (req, res) => {
  try {
    const adSets = await AdSet.find({ campaignId: req.params.campaignId })
      .sort({ createdAt: -1 });

    res.json({ success: true, data: adSets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new ad set
router.post("/", async (req, res) => {
  try {
    // Verify campaign exists
    const campaign = await Campaign.findById(req.body.campaignId);
    if (!campaign) {
      return res.status(404).json({ success: false, error: "Campaña no encontrada" });
    }

    const adSet = new AdSet(req.body);
    await adSet.save();

    res.status(201).json({ success: true, data: adSet });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update ad set
router.put("/:id", async (req, res) => {
  try {
    const adSet = await AdSet.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate("campaignId", "name ref");

    if (!adSet) {
      return res.status(404).json({ success: false, error: "AdSet no encontrado" });
    }

    res.json({ success: true, data: adSet });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete ad set
router.delete("/:id", async (req, res) => {
  try {
    const adSet = await AdSet.findByIdAndDelete(req.params.id);

    if (!adSet) {
      return res.status(404).json({ success: false, error: "AdSet no encontrado" });
    }

    res.json({ success: true, message: "AdSet eliminado correctamente" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update ad set metrics
router.patch("/:id/metrics", async (req, res) => {
  try {
    const adSet = await AdSet.findById(req.params.id);

    if (!adSet) {
      return res.status(404).json({ success: false, error: "AdSet no encontrado" });
    }

    Object.keys(req.body).forEach(key => {
      if (adSet.metrics[key] !== undefined) {
        adSet.metrics[key] = req.body[key];
      }
    });

    adSet.metrics.lastUpdated = new Date();
    await adSet.save();

    res.json({ success: true, data: adSet });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
