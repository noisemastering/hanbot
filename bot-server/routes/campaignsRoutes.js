// routes/campaignsRoutes.js
const express = require("express");
const router = express.Router();
const Campaign = require("../models/Campaign");

// Listar todas las campañas
router.get("/", async (req, res) => {
  try {
    const campaigns = await Campaign.find()
      .populate("productIds", "name size price familyId")
      .sort({ createdAt: -1 });
    res.json({ success: true, data: campaigns });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Obtener una campaña por ID
router.get("/:id", async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id)
      .populate("productIds", "name size price familyId");
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
      .populate("productIds", "name size price familyId");
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
    const campaign = await Campaign.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate("productIds", "name size price familyId");
    if (!campaign) {
      return res.status(404).json({ success: false, error: "Campaña no encontrada" });
    }
    res.json({ success: true, data: campaign });
  } catch (err) {
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
