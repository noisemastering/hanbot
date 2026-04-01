// routes/campaignsRoutes.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const Campaign = require("../models/Campaign");
const AdSet = require("../models/AdSet");
const Ad = require("../models/Ad");
const DashboardUser = require("../models/DashboardUser");
const { syncAll } = require("../utils/facebookAdsSync");

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";

// Authentication middleware (for protected routes)
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ success: false, error: "No token provided" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await DashboardUser.findById(decoded.id).select("-password");

    if (!user || !user.active) {
      return res.status(401).json({ success: false, error: "Invalid token or inactive user" });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
};

// Get campaigns tree (campaigns with nested adsets and ads)
router.get("/tree", async (req, res) => {
  try {
    // Get all campaigns
    const campaigns = await Campaign.find().lean().sort({ createdAt: -1 });

    // For each campaign, populate adsets and ads
    const campaignsWithTree = await Promise.all(
      campaigns.map(async (campaign) => {
        // Get adsets for this campaign
        const adsets = await AdSet.find({ campaignId: campaign._id }).lean();

        // For each adset, get its ads
        const adsetsWithAds = await Promise.all(
          adsets.map(async (adset) => {
            const ads = await Ad.find({ adSetId: adset._id })
              .populate('productIds', 'name description sellable')
              .lean();
            return {
              ...adset,
              children: ads.map(ad => ({ ...ad, type: 'ad' })),
              type: 'adset'
            };
          })
        );

        return {
          ...campaign,
          children: adsetsWithAds,
          type: 'campaign'
        };
      })
    );

    res.json({ success: true, data: campaignsWithTree });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Listar todas las campañas
router.get("/", async (req, res) => {
  try {
    const campaigns = await Campaign.find()
      .populate("productIds", "name description sellable")
      .sort({ createdAt: -1 });
    res.json({ success: true, data: campaigns });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sync campaigns, ad sets, and ads from Facebook Marketing API
router.post("/sync-facebook", authenticate, async (req, res) => {
  try {
    console.log("🔄 Facebook Ads sync triggered by user:", req.user.email || req.user.username);
    const results = await syncAll();
    console.log("✅ Facebook Ads sync complete:", JSON.stringify(results, null, 2));

    res.json({
      success: true,
      results: {
        campaigns: { created: results.campaigns.created, updated: results.campaigns.updated },
        adSets: { created: results.adSets.created, updated: results.adSets.updated },
        ads: { created: results.ads.created, updated: results.ads.updated }
      }
    });
  } catch (err) {
    console.error("❌ Facebook Ads sync error:", err.message);
    res.status(500).json({
      success: false,
      error: `Facebook sync failed: ${err.message}`
    });
  }
});

// Obtener una campaña por ID
router.get("/:id", async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id)
      .populate("productIds", "name description sellable");
    if (!campaign) {
      return res.status(404).json({ success: false, error: "Campaña no encontrada" });
    }
    res.json({ success: true, data: campaign });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Buscar campaña por ref
router.get("/ref/:ref", async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ ref: req.params.ref })
      .populate("productIds", "name description sellable");
    if (!campaign) {
      return res.status(404).json({ success: false, error: "Campaña no encontrada" });
    }
    res.json({ success: true, data: campaign });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Crear una nueva campaña
router.post("/", async (req, res) => {
  try {
    // Convert product IDs to ObjectId type
    if (req.body.productIds && Array.isArray(req.body.productIds)) {
      req.body.productIds = req.body.productIds.map(id => new mongoose.Types.ObjectId(id));
    }

    const campaign = new Campaign(req.body);
    await campaign.save();
    res.status(201).json({ success: true, data: campaign });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Actualizar una campaña
router.put("/:id", async (req, res) => {
  try {
    console.log('📝 PUT /campaigns/:id - Received body:', JSON.stringify(req.body, null, 2));
    console.log('📝 conversationGoal in request:', req.body.conversationGoal);

    // Convert product IDs to ObjectId type
    if (req.body.productIds && Array.isArray(req.body.productIds)) {
      req.body.productIds = req.body.productIds.map(id => new mongoose.Types.ObjectId(id));
    }

    const campaign = await Campaign.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate("productIds", "name description sellable");

    if (!campaign) {
      return res.status(404).json({ success: false, error: "Campaña no encontrada" });
    }

    // Cascade active state to child ad sets and ads
    if (req.body.active !== undefined) {
      const newStatus = req.body.active ? 'ACTIVE' : 'PAUSED';
      const adSets = await AdSet.find({ campaignId: req.params.id });
      await AdSet.updateMany({ campaignId: req.params.id }, { status: newStatus });
      if (adSets.length > 0) {
        const adSetIds = adSets.map(s => s._id);
        await Ad.updateMany({ adSetId: { $in: adSetIds } }, { status: newStatus });
      }
    }

    console.log('📝 Updated campaign conversationGoal:', campaign.conversationGoal);
    res.json({ success: true, data: campaign });
  } catch (err) {
    console.error('❌ Error updating campaign:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Eliminar una campaña
router.delete("/:id", async (req, res) => {
  try {
    const campaign = await Campaign.findByIdAndDelete(req.params.id);
    if (!campaign) {
      return res.status(404).json({ success: false, error: "Campaña no encontrada" });
    }
    res.json({ success: true, message: "Campaña eliminada correctamente" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Actualizar métricas de campaña
router.patch("/:id/metrics", async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ success: false, error: "Campaña no encontrada" });
    }

    // Actualizar las métricas especificadas
    Object.keys(req.body).forEach(key => {
      if (campaign.metrics[key] !== undefined) {
        campaign.metrics[key] = req.body[key];
      }
    });

    await campaign.save();
    res.json({ success: true, data: campaign });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
