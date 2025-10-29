// routes/campaignProductsRoutes.js
const express = require("express");
const router = express.Router();
const CampaignProduct = require("../models/CampaignProduct");

// Listar todos los campaign-products
router.get("/", async (req, res) => {
  try {
    const { campaignRef } = req.query;
    const filter = campaignRef ? { campaignRef } : {};
    const campaignProducts = await CampaignProduct.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: campaignProducts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Obtener un campaign-product por ID
router.get("/:id", async (req, res) => {
  try {
    const campaignProduct = await CampaignProduct.findById(req.params.id);
    if (!campaignProduct) {
      return res.status(404).json({ success: false, error: "Campaign-Product no encontrado" });
    }
    res.json({ success: true, data: campaignProduct });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Obtener campaign-products por campaignRef
router.get("/campaign/:campaignRef", async (req, res) => {
  try {
    const campaignProducts = await CampaignProduct.find({
      campaignRef: req.params.campaignRef
    });
    res.json({ success: true, data: campaignProducts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Crear un nuevo campaign-product
router.post("/", async (req, res) => {
  try {
    const campaignProduct = new CampaignProduct(req.body);
    await campaignProduct.save();
    res.status(201).json({ success: true, data: campaignProduct });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Actualizar un campaign-product
router.put("/:id", async (req, res) => {
  try {
    const campaignProduct = await CampaignProduct.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!campaignProduct) {
      return res.status(404).json({ success: false, error: "Campaign-Product no encontrado" });
    }
    res.json({ success: true, data: campaignProduct });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Eliminar un campaign-product
router.delete("/:id", async (req, res) => {
  try {
    const campaignProduct = await CampaignProduct.findByIdAndDelete(req.params.id);
    if (!campaignProduct) {
      return res.status(404).json({ success: false, error: "Campaign-Product no encontrado" });
    }
    res.json({ success: true, message: "Campaign-Product eliminado correctamente" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Agregar una variante a un campaign-product
router.post("/:id/variants", async (req, res) => {
  try {
    const campaignProduct = await CampaignProduct.findById(req.params.id);
    if (!campaignProduct) {
      return res.status(404).json({ success: false, error: "Campaign-Product no encontrado" });
    }

    campaignProduct.variants.push(req.body);
    await campaignProduct.save();

    res.json({ success: true, data: campaignProduct });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Actualizar una variante específica
router.put("/:id/variants/:variantId", async (req, res) => {
  try {
    const campaignProduct = await CampaignProduct.findById(req.params.id);
    if (!campaignProduct) {
      return res.status(404).json({ success: false, error: "Campaign-Product no encontrado" });
    }

    const variant = campaignProduct.variants.id(req.params.variantId);
    if (!variant) {
      return res.status(404).json({ success: false, error: "Variante no encontrada" });
    }

    Object.assign(variant, req.body);
    await campaignProduct.save();

    res.json({ success: true, data: campaignProduct });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Eliminar una variante específica
router.delete("/:id/variants/:variantId", async (req, res) => {
  try {
    const campaignProduct = await CampaignProduct.findById(req.params.id);
    if (!campaignProduct) {
      return res.status(404).json({ success: false, error: "Campaign-Product no encontrado" });
    }

    campaignProduct.variants.id(req.params.variantId).remove();
    await campaignProduct.save();

    res.json({ success: true, data: campaignProduct });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
