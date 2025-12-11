// routes/usosRoutes.js
const express = require("express");
const router = express.Router();
const Uso = require("../models/Uso");

// Get all usos
router.get("/", async (req, res) => {
  try {
    const usos = await Uso.find()
      .populate('products', 'name description imageUrl price sellable generation')
      .sort({ priority: -1, createdAt: -1 });
    res.json({ success: true, data: usos });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get a single uso
router.get("/:id", async (req, res) => {
  try {
    const uso = await Uso.findById(req.params.id)
      .populate('products', 'name description imageUrl price sellable generation parentId');
    if (!uso) {
      return res.status(404).json({ success: false, error: "Uso no encontrado" });
    }
    res.json({ success: true, data: uso });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create a new uso
router.post("/", async (req, res) => {
  try {
    const uso = new Uso(req.body);
    await uso.save();

    // Populate before returning
    await uso.populate('products', 'name description imageUrl price sellable generation');

    res.status(201).json({ success: true, data: uso });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update a uso
router.put("/:id", async (req, res) => {
  try {
    const uso = await Uso.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    )
      .populate('products', 'name description imageUrl price sellable generation');

    if (!uso) {
      return res.status(404).json({ success: false, error: "Uso no encontrado" });
    }
    res.json({ success: true, data: uso });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete a uso
router.delete("/:id", async (req, res) => {
  try {
    const uso = await Uso.findByIdAndDelete(req.params.id);
    if (!uso) {
      return res.status(404).json({ success: false, error: "Uso no encontrado" });
    }
    res.json({ success: true, message: "Uso eliminado correctamente" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
