// routes/adsRoutes.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Ad = require("../models/Ad");
const AdSet = require("../models/AdSet");
const Campaign = require("../models/Campaign");

// Check flowRef exists in hierarchy: Ad → AdSet → Campaign
async function validateFlowRefHierarchy(flowRef, adSetId, convoFlowRef) {
  if (flowRef || convoFlowRef) return true;
  const adSet = await AdSet.findById(adSetId).populate("campaignId", "flowRef");
  if (!adSet) return false;
  if (adSet.flowRef) return true;
  if (adSet.campaignId?.flowRef) return true;
  return false;
}

// Get all ads (optionally filter by adSet and/or search)
router.get("/", async (req, res) => {
  try {
    const { adSetId, search } = req.query;
    const filter = adSetId ? { adSetId } : {};

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      filter.$or = [
        { name: regex },
        { fbAdId: regex },
        { postId: regex },
        { _id: search.match(/^[0-9a-fA-F]{24}$/) ? search : undefined }
      ].filter(c => !Object.values(c).includes(undefined));
    }

    const ads = await Ad.find(filter)
      .populate({
        path: "adSetId",
        select: "name fbAdSetId catalog productIds flowRef audience adContext conversationGoal",
        populate: {
          path: "campaignId",
          select: "name ref catalog flowRef audience ad conversationGoal"
        }
      })
      .populate("productIds", "name description sellable")
      .populate("promoId", "name active")
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
        select: "name fbAdSetId catalog productIds flowRef audience adContext conversationGoal",
        populate: {
          path: "campaignId",
          select: "name ref catalog flowRef audience ad conversationGoal"
        }
      })
      .populate("productIds", "name description sellable")
      .populate("promoId", "name active");

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
    if (!req.body.adSetId) {
      return res.status(400).json({ success: false, error: "Debes seleccionar un Ad Set" });
    }
    const adSet = await AdSet.findById(req.body.adSetId);
    if (!adSet) {
      return res.status(404).json({ success: false, error: "AdSet no encontrado" });
    }

    // Validate flowRef hierarchy for ACTIVE ads
    if (req.body.status === 'ACTIVE') {
      const hasFlow = await validateFlowRefHierarchy(req.body.flowRef, req.body.adSetId, req.body.convoFlowRef);
      if (!hasFlow) {
        return res.status(400).json({
          success: false,
          error: "Un anuncio activo necesita un flujo asignado en algún nivel (anuncio, ad set o campaña)"
        });
      }
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

    // Validate flowRef hierarchy for ACTIVE ads
    if (req.body.status === 'ACTIVE') {
      const adSetId = req.body.adSetId || (await Ad.findById(req.params.id, 'adSetId'))?.adSetId;
      if (adSetId) {
        const hasFlow = await validateFlowRefHierarchy(req.body.flowRef, adSetId, req.body.convoFlowRef);
        if (!hasFlow) {
          return res.status(400).json({
            success: false,
            error: "Un anuncio activo necesita un flujo asignado en algún nivel (anuncio, ad set o campaña)"
          });
        }
      }
    }

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
      select: "name fbAdSetId catalog productIds flowRef audience adContext conversationGoal",
      populate: {
        path: "campaignId",
        select: "name ref catalog flowRef audience ad conversationGoal"
      }
    }).populate("productIds", "name description sellable")
      .populate("promoId", "name active");

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

// Set direct tracked link on an ad
router.put("/:id/direct-link", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: "URL is required" });

    const { setDirectLink } = require("../tracking");
    const result = await setDirectLink(req.params.id, url);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Remove direct tracked link from an ad
router.delete("/:id/direct-link", async (req, res) => {
  try {
    const { removeDirectLink } = require("../tracking");
    await removeDirectLink(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Get direct ad click stats for an ad
router.get("/:id/direct-clicks", async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    if (!ad) return res.status(404).json({ success: false, error: "Ad not found" });

    const ClickLog = require("../models/ClickLog");
    const filter = { source: "direct_ad", adId: ad.fbAdId };

    const [totalClicks, conversions, revenue] = await Promise.all([
      ClickLog.countDocuments(filter),
      ClickLog.countDocuments({ ...filter, converted: true }),
      ClickLog.aggregate([
        { $match: { ...filter, converted: true, "conversionData.totalAmount": { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: "$conversionData.totalAmount" } } }
      ])
    ]);

    res.json({
      success: true,
      data: {
        totalClicks,
        conversions,
        revenue: revenue[0]?.total || 0,
        conversionRate: totalClicks > 0 ? ((conversions / totalClicks) * 100).toFixed(1) : 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
