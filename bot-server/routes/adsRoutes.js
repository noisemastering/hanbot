// routes/adsRoutes.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Ad = require("../models/Ad");
const AdSet = require("../models/AdSet");

// Get all ads (optionally filter by adSet)
router.get("/", async (req, res) => {
  try {
    const { adSetId } = req.query;
    const filter = adSetId ? { adSetId } : {};

    const ads = await Ad.find(filter)
      .populate({
        path: "adSetId",
        select: "name fbAdSetId catalog productIds",
        populate: {
          path: "campaignId",
          select: "name ref catalog"
        }
      })
      .populate("productIds", "name description sellable")
      .sort({ createdAt: -1 });

    res.json({ success: true, data: ads });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single ad by ID
router.get("/:id", async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id)
      .populate({
        path: "adSetId",
        select: "name fbAdSetId catalog productIds",
        populate: {
          path: "campaignId",
          select: "name ref catalog"
        }
      })
      .populate("productIds", "name description sellable");

    if (!ad) {
      return res.status(404).json({ success: false, error: "Ad no encontrado" });
    }

    res.json({ success: true, data: ad });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get ads by ad set ID
router.get("/adset/:adSetId", async (req, res) => {
  try {
    const ads = await Ad.find({ adSetId: req.params.adSetId })
      .sort({ createdAt: -1 });

    res.json({ success: true, data: ads });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new ad
router.post("/", async (req, res) => {
  try {
    // Verify ad set exists
    const adSet = await AdSet.findById(req.body.adSetId);
    if (!adSet) {
      return res.status(404).json({ success: false, error: "AdSet no encontrado" });
    }

    // Convert product IDs to ObjectId type
    if (req.body.productIds && Array.isArray(req.body.productIds)) {
      req.body.productIds = req.body.productIds.map(id => new mongoose.Types.ObjectId(id));
    }

    const ad = new Ad(req.body);
    await ad.save();

    res.status(201).json({ success: true, data: ad });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update ad
router.put("/:id", async (req, res) => {
  try {
    // Debug logging
    console.log('🔍 PUT /ads/:id received:', {
      adAngle: req.body.adAngle,
      adIntent: req.body.adIntent
    });

    // Convert product IDs to ObjectId type
    if (req.body.productIds && Array.isArray(req.body.productIds)) {
      req.body.productIds = req.body.productIds.map(id => new mongoose.Types.ObjectId(id));
    }

    const ad = await Ad.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate({
      path: "adSetId",
      select: "name fbAdSetId catalog productIds",
      populate: {
        path: "campaignId",
        select: "name ref catalog"
      }
    }).populate("productIds", "name description sellable");

    if (!ad) {
      return res.status(404).json({ success: false, error: "Ad no encontrado" });
    }

    console.log('🔍 PUT /ads/:id saved:', {
      adAngle: ad.adAngle,
      adIntent: ad.adIntent
    });

    res.json({ success: true, data: ad });
  } catch (err) {
    console.error('❌ PUT /ads/:id error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete ad
router.delete("/:id", async (req, res) => {
  try {
    const ad = await Ad.findByIdAndDelete(req.params.id);

    if (!ad) {
      return res.status(404).json({ success: false, error: "Ad no encontrado" });
    }

    res.json({ success: true, message: "Ad eliminado correctamente" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update ad metrics
router.patch("/:id/metrics", async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);

    if (!ad) {
      return res.status(404).json({ success: false, error: "Ad no encontrado" });
    }

    Object.keys(req.body).forEach(key => {
      if (ad.metrics[key] !== undefined) {
        ad.metrics[key] = req.body[key];
      }
    });

    ad.metrics.lastUpdated = new Date();
    await ad.save();

    res.json({ success: true, data: ad });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
