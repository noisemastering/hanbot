// routes/intentCategoriesRoutes.js
const express = require("express");
const router = express.Router();
const IntentCategory = require("../models/IntentCategory");

// List all categories
router.get("/", async (req, res) => {
  try {
    const categories = await IntentCategory.find()
      .sort({ order: 1, name: 1 });
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single category
router.get("/:id", async (req, res) => {
  try {
    const category = await IntentCategory.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, error: "Categoría no encontrada" });
    }
    res.json({ success: true, data: category });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create category
router.post("/", async (req, res) => {
  try {
    const category = new IntentCategory(req.body);
    await category.save();
    res.status(201).json({ success: true, data: category });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, error: "Ya existe una categoría con esa key" });
    }
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update category
router.put("/:id", async (req, res) => {
  try {
    const category = await IntentCategory.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!category) {
      return res.status(404).json({ success: false, error: "Categoría no encontrada" });
    }
    res.json({ success: true, data: category });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, error: "Ya existe una categoría con esa key" });
    }
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete category
router.delete("/:id", async (req, res) => {
  try {
    // Check if any intents use this category
    const Intent = require("../models/Intent");
    const category = await IntentCategory.findById(req.params.id);

    if (!category) {
      return res.status(404).json({ success: false, error: "Categoría no encontrada" });
    }

    const intentsUsingCategory = await Intent.countDocuments({ category: category.key });
    if (intentsUsingCategory > 0) {
      return res.status(400).json({
        success: false,
        error: `No se puede eliminar: ${intentsUsingCategory} intents usan esta categoría`
      });
    }

    await IntentCategory.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Categoría eliminada correctamente" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reorder categories
router.post("/reorder", async (req, res) => {
  try {
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ success: false, error: "orderedIds debe ser un array" });
    }

    for (let i = 0; i < orderedIds.length; i++) {
      await IntentCategory.findByIdAndUpdate(orderedIds[i], { order: i });
    }

    const categories = await IntentCategory.find().sort({ order: 1 });
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
