// routes/pointsOfSaleRoutes.js
const express = require("express");
const router = express.Router();
const PointOfSale = require("../models/PointOfSale");

// Get all points of sale
router.get("/", async (req, res) => {
  try {
    // Get query parameter for filtering active only
    const activeOnly = req.query.active === 'true';

    const query = activeOnly ? { active: true } : {};
    const pointsOfSale = await PointOfSale.find(query).sort({ name: 1 });

    res.json({ success: true, data: pointsOfSale });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single point of sale by ID
router.get("/:id", async (req, res) => {
  try {
    const pointOfSale = await PointOfSale.findById(req.params.id);

    if (!pointOfSale) {
      return res.status(404).json({
        success: false,
        error: "Punto de venta no encontrado"
      });
    }

    res.json({ success: true, data: pointOfSale });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new point of sale
router.post("/", async (req, res) => {
  try {
    console.log('📝 Creating point of sale');
    console.log('   Received data:', JSON.stringify(req.body, null, 2));

    const pointOfSale = new PointOfSale(req.body);
    await pointOfSale.save();

    console.log('✅ Saved point of sale:', pointOfSale.name);

    res.status(201).json({ success: true, data: pointOfSale });
  } catch (err) {
    console.error('❌ Error creating point of sale:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update point of sale
router.put("/:id", async (req, res) => {
  try {
    console.log('📝 Updating point of sale', req.params.id);
    console.log('   Received data:', JSON.stringify(req.body, null, 2));

    const pointOfSale = await PointOfSale.findById(req.params.id);

    if (!pointOfSale) {
      return res.status(404).json({
        success: false,
        error: "Punto de venta no encontrado"
      });
    }

    // Update fields
    Object.keys(req.body).forEach(key => {
      pointOfSale[key] = req.body[key];
    });

    await pointOfSale.save();

    console.log('✅ Updated point of sale:', pointOfSale.name);

    res.json({ success: true, data: pointOfSale });
  } catch (err) {
    console.error('❌ Error updating point of sale:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete point of sale
router.delete("/:id", async (req, res) => {
  try {
    const pointOfSale = await PointOfSale.findById(req.params.id);

    if (!pointOfSale) {
      return res.status(404).json({
        success: false,
        error: "Punto de venta no encontrado"
      });
    }

    console.log(`🗑️ Deleting point of sale "${pointOfSale.name}"...`);

    await PointOfSale.findByIdAndDelete(req.params.id);

    console.log('✅ Point of sale deleted');

    res.json({
      success: true,
      message: "Punto de venta eliminado correctamente"
    });
  } catch (err) {
    console.error("Error deleting point of sale:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
