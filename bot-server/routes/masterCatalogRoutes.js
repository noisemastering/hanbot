// routes/masterCatalogRoutes.js
const express = require("express");
const router = express.Router();
const ProductSubfamily = require("../models/ProductSubfamily");

// Get all master catalog entries
router.get("/", async (req, res) => {
  try {
    const subfamilies = await ProductSubfamily.find()
      .sort({ createdAt: -1 });
    res.json({ success: true, data: subfamilies });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get a single master catalog entry
router.get("/:id", async (req, res) => {
  try {
    const subfamily = await ProductSubfamily.findById(req.params.id);
    if (!subfamily) {
      return res.status(404).json({ success: false, error: "Entrada no encontrada" });
    }
    res.json({ success: true, data: subfamily });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create a new master catalog entry
router.post("/", async (req, res) => {
  try {
    const subfamily = new ProductSubfamily(req.body);
    await subfamily.save();

    res.status(201).json({ success: true, data: subfamily });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update a master catalog entry
router.put("/:id", async (req, res) => {
  try {
    const subfamily = await ProductSubfamily.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!subfamily) {
      return res.status(404).json({ success: false, error: "Entrada no encontrada" });
    }
    res.json({ success: true, data: subfamily });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete a master catalog entry
router.delete("/:id", async (req, res) => {
  try {
    const subfamily = await ProductSubfamily.findByIdAndDelete(req.params.id);
    if (!subfamily) {
      return res.status(404).json({ success: false, error: "Entrada no encontrada" });
    }
    res.json({ success: true, message: "Entrada eliminada correctamente" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
