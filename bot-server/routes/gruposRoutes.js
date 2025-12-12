// routes/gruposRoutes.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Grupo = require("../models/Grupo");

// Get all grupos
router.get("/", async (req, res) => {
  try {
    const grupos = await Grupo.find()
      .populate('products', 'name description imageUrl price sellable generation')
      .populate('suggestedProducts', 'name description imageUrl price sellable generation')
      .sort({ priority: -1, createdAt: -1 });
    res.json({ success: true, data: grupos });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get grupos by type
router.get("/type/:type", async (req, res) => {
  try {
    const grupos = await Grupo.find({ type: req.params.type, available: true })
      .populate('products', 'name description imageUrl price sellable generation')
      .populate('suggestedProducts', 'name description imageUrl price sellable generation')
      .sort({ priority: -1 });
    res.json({ success: true, data: grupos });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get grupos by tag
router.get("/tag/:tag", async (req, res) => {
  try {
    const grupos = await Grupo.find({ tags: req.params.tag, available: true })
      .populate('products', 'name description imageUrl price sellable generation')
      .populate('suggestedProducts', 'name description imageUrl price sellable generation')
      .sort({ priority: -1 });
    res.json({ success: true, data: grupos });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get related grupos for a product
router.get("/product/:productId", async (req, res) => {
  try {
    const grupos = await Grupo.find({
      $or: [
        { products: req.params.productId },
        { suggestedProducts: req.params.productId }
      ],
      available: true
    })
      .populate('products', 'name description imageUrl price sellable generation')
      .populate('suggestedProducts', 'name description imageUrl price sellable generation')
      .sort({ priority: -1 });
    res.json({ success: true, data: grupos });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get a single grupo
router.get("/:id", async (req, res) => {
  try {
    const grupo = await Grupo.findById(req.params.id)
      .populate('products', 'name description imageUrl price sellable generation parentId')
      .populate('suggestedProducts', 'name description imageUrl price sellable generation parentId');

    if (!grupo) {
      return res.status(404).json({ success: false, error: "Grupo no encontrado" });
    }
    res.json({ success: true, data: grupo });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create a new grupo
router.post("/", async (req, res) => {
  try {
    // Convert product IDs to ObjectId type
    if (req.body.products && Array.isArray(req.body.products)) {
      req.body.products = req.body.products.map(id =>
        typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id
      );
    }
    if (req.body.suggestedProducts && Array.isArray(req.body.suggestedProducts)) {
      req.body.suggestedProducts = req.body.suggestedProducts.map(id =>
        typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id
      );
    }

    const grupo = new Grupo(req.body);
    await grupo.save();

    // Populate before returning
    await grupo.populate('products', 'name description imageUrl price sellable generation');
    await grupo.populate('suggestedProducts', 'name description imageUrl price sellable generation');

    res.status(201).json({ success: true, data: grupo });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update a grupo
router.put("/:id", async (req, res) => {
  try {
    // Convert product IDs to ObjectId type
    if (req.body.products && Array.isArray(req.body.products)) {
      req.body.products = req.body.products.map(id =>
        typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id
      );
    }
    if (req.body.suggestedProducts && Array.isArray(req.body.suggestedProducts)) {
      req.body.suggestedProducts = req.body.suggestedProducts.map(id =>
        typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id
      );
    }

    const grupo = await Grupo.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    )
      .populate('products', 'name description imageUrl price sellable generation')
      .populate('suggestedProducts', 'name description imageUrl price sellable generation');

    if (!grupo) {
      return res.status(404).json({ success: false, error: "Grupo no encontrado" });
    }
    res.json({ success: true, data: grupo });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete a grupo
router.delete("/:id", async (req, res) => {
  try {
    const grupo = await Grupo.findByIdAndDelete(req.params.id);
    if (!grupo) {
      return res.status(404).json({ success: false, error: "Grupo no encontrado" });
    }
    res.json({ success: true, message: "Grupo eliminado correctamente" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
