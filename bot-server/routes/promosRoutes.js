const express = require("express");
const router = express.Router();
const Promo = require("../models/Promo");

// GET all promos
router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.active === 'true') filter.active = true;
    const promos = await Promo.find(filter)
      .populate("promoProductIds", "name size price")
      .sort({ createdAt: -1 });
    res.json({ success: true, data: promos });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET single promo
router.get("/:id", async (req, res) => {
  try {
    const promo = await Promo.findById(req.params.id)
      .populate("promoProductIds", "name size price");
    if (!promo) return res.status(404).json({ success: false, error: "Promo no encontrada" });
    res.json({ success: true, data: promo });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create promo
router.post("/", async (req, res) => {
  try {
    const promo = new Promo(req.body);
    await promo.save();
    res.status(201).json({ success: true, data: promo });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PUT update promo
router.put("/:id", async (req, res) => {
  try {
    const promo = await Promo.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate("promoProductIds", "name size price");
    if (!promo) return res.status(404).json({ success: false, error: "Promo no encontrada" });
    res.json({ success: true, data: promo });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE promo
router.delete("/:id", async (req, res) => {
  try {
    const promo = await Promo.findByIdAndDelete(req.params.id);
    if (!promo) return res.status(404).json({ success: false, error: "Promo no encontrada" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
