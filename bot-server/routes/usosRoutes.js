// routes/usosRoutes.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
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
    console.log('📝 Creating new uso with data:', JSON.stringify(req.body, null, 2));

    // Convert product IDs to ObjectId type
    if (req.body.products && Array.isArray(req.body.products)) {
      req.body.products = req.body.products.map(id =>
        typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id
      );
    }

    const uso = new Uso(req.body);
    await uso.save();

    // Populate before returning
    await uso.populate('products', 'name description imageUrl price sellable generation');

    console.log('✅ Uso saved successfully. Products count:', uso.products?.length || 0);
    res.status(201).json({ success: true, data: uso });
  } catch (err) {
    console.error('❌ Error creating uso:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update a uso
router.put("/:id", async (req, res) => {
  try {
    console.log('📝 Updating uso', req.params.id, 'with data:', JSON.stringify(req.body, null, 2));

    // Convert product IDs to ObjectId type
    if (req.body.products && Array.isArray(req.body.products)) {
      req.body.products = req.body.products.map(id =>
        typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id
      );
    }

    const uso = await Uso.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    )
      .populate('products', 'name description imageUrl price sellable generation');

    if (!uso) {
      return res.status(404).json({ success: false, error: "Uso no encontrado" });
    }
    console.log('✅ Uso updated successfully. Products count:', uso.products?.length || 0);
    res.json({ success: true, data: uso });
  } catch (err) {
    console.error('❌ Error updating uso:', err.message);
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
