// routes/productFamilyRoutes.js
const express = require("express");
const router = express.Router();
const ProductFamily = require("../models/ProductFamily");

// ============================================
// TREE-SPECIFIC OPERATIONS
// ============================================

// Get complete tree structure (all roots with populated children recursively)
router.get("/tree", async (req, res) => {
  try {
    // Get all root products (generation 1, parentId = null)
    const roots = await ProductFamily.find({ parentId: null }).lean();

    // Recursively populate children for each root
    const populatedRoots = await Promise.all(
      roots.map(root => populateChildren(root))
    );

    res.json({ success: true, data: populatedRoots });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get only root products (generation 1, parentId = null)
router.get("/roots", async (req, res) => {
  try {
    const roots = await ProductFamily.find({ parentId: null }).sort({ name: 1 });
    res.json({ success: true, data: roots });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get only sellable products (for campaigns)
router.get("/sellable", async (req, res) => {
  try {
    const sellableProducts = await ProductFamily.find({
      sellable: true,
      available: true
    }).sort({ name: 1 });

    res.json({ success: true, data: sellableProducts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get direct children of a product
router.get("/:id/children", async (req, res) => {
  try {
    const children = await ProductFamily.find({
      parentId: req.params.id
    }).sort({ name: 1 });

    res.json({ success: true, data: children });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// STANDARD CRUD OPERATIONS
// ============================================

// Get all product families
router.get("/", async (req, res) => {
  try {
    const productFamilies = await ProductFamily.find()
      .populate('parentId', 'name generation')
      .sort({ generation: 1, name: 1 });

    res.json({ success: true, data: productFamilies });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single product family by ID
router.get("/:id", async (req, res) => {
  try {
    const productFamily = await ProductFamily.findById(req.params.id)
      .populate('parentId', 'name generation');

    if (!productFamily) {
      return res.status(404).json({
        success: false,
        error: "Familia de producto no encontrada"
      });
    }

    res.json({ success: true, data: productFamily });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new product family
router.post("/", async (req, res) => {
  try {
    const productFamily = new ProductFamily(req.body);
    await productFamily.save();

    // Populate parent info before returning
    await productFamily.populate('parentId', 'name generation');

    res.status(201).json({ success: true, data: productFamily });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update product family
router.put("/:id", async (req, res) => {
  try {
    const productFamily = await ProductFamily.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('parentId', 'name generation');

    if (!productFamily) {
      return res.status(404).json({
        success: false,
        error: "Familia de producto no encontrada"
      });
    }

    res.json({ success: true, data: productFamily });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete product family
router.delete("/:id", async (req, res) => {
  try {
    // Check if this product has children
    const childrenCount = await ProductFamily.countDocuments({
      parentId: req.params.id
    });

    if (childrenCount > 0) {
      return res.status(400).json({
        success: false,
        error: `No se puede eliminar: esta familia tiene ${childrenCount} subfamilia(s). Elimina primero los hijos.`
      });
    }

    const productFamily = await ProductFamily.findByIdAndDelete(req.params.id);

    if (!productFamily) {
      return res.status(404).json({
        success: false,
        error: "Familia de producto no encontrada"
      });
    }

    res.json({
      success: true,
      message: "Familia de producto eliminada correctamente"
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Recursively populate children for a product family node
 * @param {Object} node - The product family node to populate
 * @returns {Object} - The node with populated children
 */
async function populateChildren(node) {
  // Get direct children
  const children = await ProductFamily.find({ parentId: node._id }).lean();

  if (children.length === 0) {
    node.children = [];
    return node;
  }

  // Recursively populate each child's children
  node.children = await Promise.all(
    children.map(child => populateChildren(child))
  );

  return node;
}

module.exports = router;
