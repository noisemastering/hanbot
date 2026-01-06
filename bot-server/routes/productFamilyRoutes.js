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
    // Get all products for Inventario management (all product families)
    // This includes products with and without prices so users can populate pricing
    const sellableProducts = await ProductFamily.find({})
    .populate('parentId')
    .sort({ name: 1 });

    // Build hierarchical names and categories for each product
    const productsWithFullNames = await Promise.all(
      sellableProducts.map(async (product) => {
        const { displayName, category, subcategory } = await buildHierarchicalName(product);
        return {
          ...product.toObject(),
          displayName,
          category,
          subcategory
        };
      })
    );

    res.json({ success: true, data: productsWithFullNames });
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
    console.log('📝 Creating product family');
    console.log('   Received data:', JSON.stringify(req.body, null, 2));
    console.log('   onlineStoreLinks in request:', req.body.onlineStoreLinks);
    console.log('   enabledDimensions in request:', req.body.enabledDimensions);
    console.log('   attributes in request:', req.body.attributes);

    const productFamily = new ProductFamily(req.body);

    // If attributes are provided, ensure they're properly set in the Map
    if (req.body.attributes) {
      productFamily.attributes.clear();
      Object.entries(req.body.attributes).forEach(([attrKey, attrValue]) => {
        productFamily.attributes.set(attrKey, attrValue);
      });
    }

    await productFamily.save();

    console.log('✅ Saved product family:', productFamily.name);
    console.log('   sellable:', productFamily.sellable);
    console.log('   requiresHumanAdvisor:', productFamily.requiresHumanAdvisor);
    console.log('   onlineStoreLinks after save:', productFamily.onlineStoreLinks);
    console.log('   enabledDimensions after save:', productFamily.enabledDimensions);
    console.log('   attributes after save:', productFamily.attributes);

    // Populate parent info before returning
    await productFamily.populate('parentId', 'name generation');

    res.status(201).json({ success: true, data: productFamily });
  } catch (err) {
    console.error('❌ Error creating product family:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update product family
router.put("/:id", async (req, res) => {
  try {
    console.log('📝 Updating product family', req.params.id);
    console.log('   Received data:', JSON.stringify(req.body, null, 2));
    console.log('   onlineStoreLinks in request:', req.body.onlineStoreLinks);
    console.log('   enabledDimensions in request:', req.body.enabledDimensions);
    console.log('   attributes in request:', req.body.attributes);

    // Find the product first
    const productFamily = await ProductFamily.findById(req.params.id);

    if (!productFamily) {
      return res.status(404).json({
        success: false,
        error: "Familia de producto no encontrada"
      });
    }

    // Update fields manually to ensure nested arrays and Maps are properly saved
    Object.keys(req.body).forEach(key => {
      // Special handling for Mongoose Map fields (attributes, dimensionUnits)
      if (key === 'attributes' && req.body[key]) {
        // Initialize Map if it doesn't exist
        if (!productFamily.attributes) {
          productFamily.attributes = new Map();
        }

        // Clear existing attributes
        productFamily.attributes.clear();

        // Repopulate with new attributes
        Object.entries(req.body[key]).forEach(([attrKey, attrValue]) => {
          productFamily.attributes.set(attrKey, attrValue);
        });
      } else if (key === 'dimensionUnits' && req.body[key]) {
        // Initialize Map if it doesn't exist
        if (!productFamily.dimensionUnits) {
          productFamily.dimensionUnits = new Map();
        }

        // Clear existing dimension units
        productFamily.dimensionUnits.clear();

        // Repopulate with new dimension units
        Object.entries(req.body[key]).forEach(([dimKey, unit]) => {
          productFamily.dimensionUnits.set(dimKey, unit);
        });
      } else {
        // Normal assignment for other fields
        productFamily[key] = req.body[key];
      }
    });

    // Save using .save() method which properly handles nested arrays and Maps
    await productFamily.save();

    // Auto-propagate dimensions to children if this is a non-sellable product with dimensions
    if (!productFamily.sellable && productFamily.enabledDimensions && productFamily.enabledDimensions.length > 0) {
      const updatedCount = await propagateDimensionValuesToDescendants(productFamily._id, {
        attributes: productFamily.attributes,
        enabledDimensions: productFamily.enabledDimensions,
        dimensionUnits: productFamily.dimensionUnits
      });
      if (updatedCount > 0) {
        console.log(`🔄 Auto-propagated dimensions to ${updatedCount} descendant(s)`);
      }
    }

    // Populate after save
    await productFamily.populate('parentId', 'name generation');

    console.log('✅ Updated product family:', productFamily.name);
    console.log('   sellable:', productFamily.sellable);
    console.log('   requiresHumanAdvisor:', productFamily.requiresHumanAdvisor);
    console.log('   onlineStoreLinks after save:', productFamily.onlineStoreLinks);
    console.log('   enabledDimensions after save:', productFamily.enabledDimensions);
    console.log('   attributes after save:', productFamily.attributes);

    res.json({ success: true, data: productFamily });
  } catch (err) {
    console.error('❌ Error updating product family:', err);
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
    const { childIds = [], targetParentId } = req.body;  // Array of child IDs to copy, optional target parent
    const productId = req.params.id;

    // Get the source product
    const sourceProduct = await ProductFamily.findById(productId).lean();
    if (!sourceProduct) {
      return res.status(404).json({ success: false, error: "Producto no encontrado" });
    }

    // Use provided targetParentId, or default to source product's parent (copy as sibling)
    const newParentId = targetParentId || sourceProduct.parentId;

    // Verify target parent exists if provided
    if (targetParentId) {
      const targetParent = await ProductFamily.findById(targetParentId);
      if (!targetParent) {
        return res.status(404).json({ success: false, error: "Padre de destino no encontrado" });
      }
      if (targetParent.sellable) {
        return res.status(400).json({ success: false, error: "Los productos vendibles no pueden tener hijos" });
      }
    }

    // Copy the product (create as child of newParentId)
    const copiedProduct = await copyProductRecursive(sourceProduct, newParentId, childIds);

    res.json({ success: true, data: copiedProduct });
  } catch (err) {
    console.error("Error copying product:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Import products from /products collection into ProductFamily tree
// Creates NEW ProductFamily documents (not linking - copying data)
router.post("/:id/import", async (req, res) => {
  try {
    const { productIds = [] } = req.body;  // Array of Product IDs to import
    const targetFamilyId = req.params.id;

    // Verify target family exists
    const targetFamily = await ProductFamily.findById(targetFamilyId);
    if (!targetFamily) {
      return res.status(404).json({ success: false, error: "Familia de destino no encontrada" });
    }

    console.log(`📥 Importing ${productIds.length} products from /products to "${targetFamily.name}"...`);

    // Load Product model (from /products collection)
    const Product = require("../models/Product");

    // Fetch the Product documents
    const products = await Product.find({ _id: { $in: productIds } });

    if (products.length === 0) {
      return res.status(404).json({ success: false, error: "No se encontraron productos" });
    }

    console.log(`Found ${products.length} products to import`);

    // Create new ProductFamily documents from Product data
    const newProductFamilies = [];
    for (const product of products) {
      // Map Product fields to ProductFamily fields
      const productFamilyData = {
        name: product.size ? `${product.name} ${product.size}` : product.name,  // Include size in name
        description: product.description || "",
        imageUrl: product.imageUrl || "",
        price: product.price ? parseFloat(product.price) : undefined,  // Convert string to number
        parentId: targetFamilyId,
        generation: targetFamily.generation + 1,
        sellable: true,  // Imported products are sellable leaf nodes
        available: true,
        active: true
      };

      // Import Mercado Libre link if it exists
      if (product.mLink) {
        productFamilyData.onlineStoreLinks = [{
          url: product.mLink,
          store: "Mercado Libre",
          isPreferred: true  // Mark as the main/preferred link
        }];
      }

      const newProductFamily = new ProductFamily(productFamilyData);
      await newProductFamily.save();
      newProductFamilies.push(newProductFamily);

      console.log(`✅ Created ProductFamily: ${newProductFamily.name}`);
    }

    console.log(`✅ Successfully imported ${newProductFamilies.length} products as new ProductFamily documents`);

    res.json({
      success: true,
      message: `${newProductFamilies.length} productos importados correctamente como nuevas familias`,
      count: newProductFamilies.length,
      data: newProductFamilies
    });
  } catch (err) {
    console.error("Error importing products:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Build hierarchical name using only Gen 3+ as the display name
 * Gen 1 and Gen 2 are used as grouping/category data
 * @param {Object} product - The product with populated parentId
 * @returns {Object} - Object with displayName, category (Gen 1), and subcategory (Gen 2)
 */
async function buildHierarchicalName(product) {
  const hierarchy = [];
  let current = product;

  // Collect the full hierarchy going up the parent chain
  while (current) {
    hierarchy.unshift({
      name: current.name,
      generation: current.generation,
      parentId: current.parentId  // Track parentId to identify roots
    });

    if (current.parentId) {
      // If parentId is already populated as an object, use it
      if (typeof current.parentId === 'object' && current.parentId.name) {
        current = current.parentId;
      } else {
        // Otherwise fetch the parent
        current = await ProductFamily.findById(current.parentId).lean();
      }
    } else {
      current = null;  // Reached the root
    }
  }

  // Extract Gen 1 (category) and Gen 2 (subcategory)
  // Gen 1 = either generation===1 OR parentId===null/undefined (root nodes, even with undefined generation)
  const category = hierarchy.find(h =>
    h.generation === 1 ||
    ((h.parentId === null || h.parentId === undefined) && h.generation !== 2)
  )?.name || null;
  const subcategory = hierarchy.find(h => h.generation === 2)?.name || null;

  // Build display name from Gen 3 onwards
  const displayParts = hierarchy
    .filter(h => h.generation >= 3)
    .map(h => h.name);

  const displayName = displayParts.length > 0
    ? displayParts.join(' - ')
    : product.name;  // Fallback to product name if no Gen 3+

  return {
    displayName,
    category,
    subcategory
  };
}

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

/**
 * Recursively propagate dimension values to all descendants
 * Parent dimension values override children's values (parent supersedes children)
 * @param {String} parentId - The parent product ID
 * @param {Map} parentAttributes - The parent's attributes Map containing dimension values
 * @returns {Number} - Total number of products updated
 */
async function propagateDimensionValuesToDescendants(parentId, parentData) {
  let updatedCount = 0;

  // Extract parent data
  const parentAttributes = parentData.attributes || new Map();
  const parentEnabledDimensions = parentData.enabledDimensions || [];
  const parentDimensionUnits = parentData.dimensionUnits || new Map();

  // Get all direct children of this product
  const children = await ProductFamily.find({ parentId: parentId });

  // Update each child
  for (const child of children) {
    // Initialize attributes Map if it doesn't exist
    if (!child.attributes) {
      child.attributes = new Map();
    }

    let childModified = false;

    // STEP 1: Sync dimension structure (enabledDimensions and dimensionUnits)
    if (parentEnabledDimensions.length > 0) {
      child.enabledDimensions = [...parentEnabledDimensions];
      childModified = true;
    }

    if (parentDimensionUnits && parentDimensionUnits.size > 0) {
      child.dimensionUnits = new Map(parentDimensionUnits);
      childModified = true;
    }

    // STEP 2: Remove dimension values that are no longer in enabledDimensions
    const allDimensions = ['width', 'length', 'height', 'depth', 'thickness', 'weight', 'diameter',
                           'side1', 'side2', 'side3', 'side4', 'side5', 'side6'];

    for (const dimKey of allDimensions) {
      if (child.attributes.has(dimKey) && !parentEnabledDimensions.includes(dimKey)) {
        child.attributes.delete(dimKey);
        childModified = true;
      }
    }

    // STEP 3: Copy parent's dimension values to child (overriding existing values)
    for (const [dimKey, dimValue] of parentAttributes) {
      // Only propagate actual dimension fields (not general attributes)
      const isDimension = allDimensions.includes(dimKey);

      if (isDimension && parentEnabledDimensions.includes(dimKey)) {
        child.attributes.set(dimKey, dimValue);
        childModified = true;
      }
    }

    // Save the child if it was modified
    if (childModified) {
      // CRITICAL: Mark fields as modified so Mongoose detects the Map changes
      child.markModified('attributes');
      child.markModified('dimensionUnits');
      await child.save();
      updatedCount += 1;
      console.log(`  📐 Updated "${child.name}" with parent's dimension structure and values`);
    }

    // Recursively propagate to this child's descendants
    const descendantCount = await propagateDimensionValuesToDescendants(child._id, {
      attributes: parentAttributes,
      enabledDimensions: parentEnabledDimensions,
      dimensionUnits: parentDimensionUnits
    });
    updatedCount += descendantCount;
  }

  return updatedCount;
}

// ============================================
// MANUAL DIMENSION PROPAGATION
// ============================================

// Manually propagate dimension values to all descendants
router.post("/:id/propagate-dimensions", async (req, res) => {
  try {
    const productId = req.params.id;

    // Get the product
    const product = await ProductFamily.findById(productId);

    if (!product) {
      return res.status(404).json({
        success: false,
        error: "Producto no encontrado"
      });
    }

    // Check if product has dimension values to propagate
    if (!product.attributes || product.attributes.size === 0) {
      return res.status(400).json({
        success: false,
        error: "Este producto no tiene valores de dimensiones para propagar"
      });
    }

    console.log(`🔄 Manual propagation requested for "${product.name}"`);

    // Propagate dimension structure and values to all descendants
    const updatedCount = await propagateDimensionValuesToDescendants(productId, {
      attributes: product.attributes,
      enabledDimensions: product.enabledDimensions,
      dimensionUnits: product.dimensionUnits
    });

    console.log(`✅ Propagated dimension values to ${updatedCount} descendant(s)`);

    res.json({
      success: true,
      message: `Dimensiones propagadas a ${updatedCount} producto(s) descendiente(s)`,
      updatedCount
    });
  } catch (err) {
    console.error("Error propagating dimensions:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// BULK PRICE UPDATE
// ============================================

// Update price for all sellable descendants of a product
router.post("/:id/bulk-update-price", async (req, res) => {
  try {
    const { price } = req.body;
    const productId = req.params.id;

    if (price === undefined || price === null) {
      return res.status(400).json({
        success: false,
        error: "Price is required"
      });
    }

    console.log(`🏷️  Bulk price update for product ${productId} to $${price}`);

    // Update all sellable descendants
    const updatedCount = await updateDescendantPrices(productId, parseFloat(price));

    console.log(`✅ Updated ${updatedCount} sellable products`);

    res.json({
      success: true,
      message: `Updated ${updatedCount} sellable products`,
      updatedCount
    });
  } catch (err) {
    console.error("Error bulk updating prices:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper function to recursively update prices for all sellable descendants
async function updateDescendantPrices(productId, price) {
  let updatedCount = 0;

  // Get all direct children of this product
  const children = await ProductFamily.find({ parentId: productId });

  // Update each child
  for (const child of children) {
    // If child is sellable, update its price
    if (child.sellable) {
      await ProductFamily.findByIdAndUpdate(child._id, { price });
      updatedCount += 1;
      console.log(`  📝 Updated ${child.name}: $${price}`);
    }

    // Recursively update this child's descendants (regardless of whether child is sellable)
    const childUpdatedCount = await updateDescendantPrices(child._id, price);
    updatedCount += childUpdatedCount;
  }

  return updatedCount;
}

module.exports = router;
