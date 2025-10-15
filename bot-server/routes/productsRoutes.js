// routes/productsRoutes.js
const express = require("express");
const router = express.Router();
const Product = require("../models/Product");

// Listar todos los productos
router.get("/", async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json({ success: true, data: products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Buscar productos por palabra clave
router.get("/search", async (req, res) => {
  const q = req.query.q || "";
  try {
    const products = await Product.find({
      $text: { $search: q }
    }).limit(10);

    res.json({ success: true, data: products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
