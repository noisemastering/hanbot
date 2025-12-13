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
    console.log('📝 Creating product family with data:', JSON.stringify(req.body, null, 2));
    const productFamily = new ProductFamily(req.body);
    await productFamily.save();
    console.log('✅ Saved product family:', productFamily.name, 'requiresHumanAdvisor:', productFamily.requiresHumanAdvisor);

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
    console.log('📝 Updating product family', req.params.id, 'with data:', JSON.stringify(req.body, null, 2));
    const productFamily = await ProductFamily.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('parentId', 'name generation');
    console.log('✅ Updated product family:', productFamily.name, 'requiresHumanAdvisor:', productFamily.requiresHumanAdvisor);

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

// Delete product family (cascade delete - deletes all descendants)
router.delete("/:id", async (req, res) => {
  try {
    const productFamily = await ProductFamily.findById(req.params.id);

    if (!productFamily) {
      return res.status(404).json({
        success: false,
        error: "Familia de producto no encontrada"
      });
    }

    // Count total descendants for logging
    const childrenCount = await ProductFamily.countDocuments({
      parentId: req.params.id
    });

    console.log(`🗑️ Deleting product "${productFamily.name}" with ${childrenCount} direct children...`);

    // Recursively delete this product and all its descendants
    const deletedCount = await deleteProductRecursive(req.params.id);

    console.log(`✅ Deleted ${deletedCount} product(s) total`);

    res.json({
      success: true,
      message: `Familia de producto eliminada correctamente (${deletedCount} producto(s) eliminado(s))`
    });
  } catch (err) {
    console.error("Error deleting product:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Copy a product (with specific children)
router.post("/:id/copy", async (req, res) => {
  try {
    const { childIds = [] } = req.body;  // Array of child IDs to copy
    const productId = req.params.id;

    // Get the source product
    const sourceProduct = await ProductFamily.findById(productId).lean();
    if (!sourceProduct) {
      return res.status(404).json({ success: false, error: "Producto no encontrado" });
    }

    // Copy the product (create as sibling with same parent)
    const copiedProduct = await copyProductRecursive(sourceProduct, sourceProduct.parentId, childIds);

    res.json({ success: true, data: copiedProduct });
  } catch (err) {
    console.error("Error copying product:", err);
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

/**
 * Recursively copy a product and specific children
 * @param {Object} sourceProduct - The product to copy
 * @param {String} newParentId - The parent ID for the copied product
 * @param {Array} childIds - Array of child IDs to copy (if empty, no children copied)
 * @returns {Object} - The newly created product
 */
async function copyProductRecursive(sourceProduct, newParentId, childIds = []) {
  // Create copy of the product (exclude _id, __v, timestamps, children)
  const { _id, __v, createdAt, updatedAt, children, ...productData } = sourceProduct;

  // Append "(Copia)" to the name
  productData.name = `${productData.name} (Copia)`;
  productData.parentId = newParentId;

  // Create the new product
  const newProduct = new ProductFamily(productData);
  await newProduct.save();

  console.log(`✅ Copied product: ${newProduct.name} (ID: ${newProduct._id})`);

  // If childIds array has items, copy those specific children
  if (childIds && childIds.length > 0) {
    // Get all children of the source product
    const sourceChildren = await ProductFamily.find({
      parentId: sourceProduct._id
    }).lean();

    // Filter to only children in the childIds array
    const childrenToCopy = sourceChildren.filter(child =>
      childIds.includes(child._id.toString())
    );

    if (childrenToCopy.length > 0) {
      console.log(`📦 Copying ${childrenToCopy.length} selected children for ${newProduct.name}...`);

      // For each selected child, copy it and ALL of its descendants
      await Promise.all(
        childrenToCopy.map(async (child) => {
          // Get all descendants of this child
          const allDescendants = await getAllDescendantIds(child._id);

          // Copy this child and all its descendants
          await copyProductRecursive(child, newProduct._id, allDescendants);
        })
      );
    }
  }

  return newProduct;
}

/**
 * Get all descendant IDs of a product
 * @param {String} productId - The product ID
 * @returns {Array} - Array of all descendant IDs
 */
async function getAllDescendantIds(productId) {
  const children = await ProductFamily.find({ parentId: productId }).lean();

  if (children.length === 0) {
    return [];
  }

  const childIds = children.map(c => c._id.toString());

  // Recursively get descendants of each child
  const descendantIds = await Promise.all(
    children.map(child => getAllDescendantIds(child._id))
  );

  // Flatten and combine
  return [...childIds, ...descendantIds.flat()];
}

/**
 * Recursively delete a product and all its descendants
 * @param {String} productId - The product ID to delete
 * @returns {Number} - Total number of products deleted
 */
async function deleteProductRecursive(productId) {
  // Get all direct children
  const children = await ProductFamily.find({ parentId: productId }).lean();

  let deletedCount = 0;

  // Recursively delete all children first
  if (children.length > 0) {
    const childDeletions = await Promise.all(
      children.map(child => deleteProductRecursive(child._id))
    );
    deletedCount += childDeletions.reduce((sum, count) => sum + count, 0);
  }

  // Delete this product
  await ProductFamily.findByIdAndDelete(productId);
  deletedCount += 1;

  return deletedCount;
}

module.exports = router;
