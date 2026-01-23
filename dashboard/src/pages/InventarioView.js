import React, { useState, useEffect } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

// Editable cell component for inline editing
function EditableCell({ value, onSave, type = "text", step, inherited = false }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  const handleSave = () => {
    if (onSave && editValue !== value) {
      onSave(editValue);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setEditValue(value);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        type={type}
        step={step}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleSave}
        autoFocus
        className="w-full px-2 py-1 bg-gray-900 border border-primary-500 rounded text-white text-sm focus:outline-none"
      />
    );
  }

  return (
    <button
      onClick={() => setIsEditing(true)}
      className={`w-full text-left px-2 py-1 hover:bg-gray-700/50 rounded transition-colors text-sm ${
        inherited ? 'text-amber-400' : 'text-white'
      }`}
    >
      {type === 'number' && step === '0.01' ? `$${parseFloat(value || 0).toFixed(2)}` : (value || 0)}
    </button>
  );
}

// Flatten product tree to get all sellable products with their parent info
function flattenSellableProducts(products, parentChain = []) {
  let result = [];

  for (const product of products) {
    if (product.sellable) {
      // Build the path/breadcrumb from parents
      const path = parentChain.map(p => p.name);

      // Get inherited price from parent chain
      let inheritedPrice = product.price;
      let priceIsInherited = product.price === undefined || product.price === null;
      if (priceIsInherited) {
        for (let i = parentChain.length - 1; i >= 0; i--) {
          if (parentChain[i].price !== undefined && parentChain[i].price !== null) {
            inheritedPrice = parentChain[i].price;
            break;
          }
        }
      }

      const productType = getProductType(product, parentChain);

      // Group by base class + product type (Confeccionada/Rollo)
      // Skip adding productType for products that are only sold one way
      const baseClass = parentChain.length >= 1 ? parentChain[0] : null;
      const baseClassName = baseClass?.name || '';
      const skipProductType = baseClassName.toLowerCase().includes('cinta') ||
                              baseClassName.toLowerCase().includes('monofilamento');

      const groupKey = baseClass ? `${baseClass._id}-${productType || 'other'}` : product._id;
      const groupName = productType && baseClass && !skipProductType
        ? `${baseClass.name} ${productType}`
        : baseClass?.name || product.name;
      // Calculate ML price discrepancy
      const hasMLPrice = product.mlPrice !== undefined && product.mlPrice !== null;
      const localPrice = product.price || inheritedPrice;
      const mlPriceDiscrepancy = hasMLPrice && localPrice
        ? localPrice - product.mlPrice
        : null;

      result.push({
        ...product,
        path,
        groupKey,
        groupName,
        inheritedPrice,
        priceIsInherited,
        mlPriceDiscrepancy,
        hasMLPrice,
        // Extract size info from path or attributes
        sizeInfo: extractSizeInfo(product, parentChain),
        colorInfo: extractColorInfo(product, parentChain),
        isTriangular: isTriangular(product, parentChain),
        productType,
        shadePercentage: productType === 'Rollo' ? getShadePercentage(product, parentChain) : null,
        reinforcementType: productType === 'Confeccionada' ? getReinforcementType(product, parentChain) : null,
        subdivision: getSubdivision(product, parentChain),
        isRompevientos: isRompevientos(product, parentChain)
      });
    }

    if (product.children && product.children.length > 0) {
      result = result.concat(flattenSellableProducts(product.children, [...parentChain, product]));
    }
  }

  return result;
}

// Get product type from parent chain (Confeccionada, Rollo, etc.)
function getProductType(product, parentChain) {
  // Check product name first
  const nameLower = product.name.toLowerCase();
  if (nameLower.includes('confeccionada')) return 'Confeccionada';
  if (nameLower.includes('rollo')) return 'Rollo';

  // Check parent chain
  for (const parent of parentChain) {
    const parentNameLower = parent.name.toLowerCase();
    if (parentNameLower.includes('confeccionada')) return 'Confeccionada';
    if (parentNameLower.includes('rollo')) return 'Rollo';
  }

  return null;
}

// Get shade percentage from product or parent chain
function getShadePercentage(product, parentChain) {
  // Check product name first
  const percentMatch = product.name.match(/(\d+)\s*%/);
  if (percentMatch) return `${percentMatch[1]}%`;

  // Check parent chain
  for (const parent of parentChain) {
    const match = parent.name.match(/(\d+)\s*%/);
    if (match) return `${match[1]}%`;
  }

  return null;
}

// Get reinforcement type for Confeccionada products
function getReinforcementType(product, parentChain) {
  // Check product name first
  const nameLower = product.name.toLowerCase();
  if (nameLower.includes('reforzada') || nameLower.includes('refuerzo')) {
    return nameLower.includes('sin refuerzo') ? 'Sin refuerzo' : 'Reforzada';
  }

  // Check parent chain
  for (const parent of parentChain) {
    const parentNameLower = parent.name.toLowerCase();
    if (parentNameLower.includes('reforzada') || parentNameLower.includes('refuerzo')) {
      return parentNameLower.includes('sin refuerzo') ? 'Sin refuerzo' : 'Reforzada';
    }
  }

  return null;
}

// Check if product is Rompevientos (windbreak tape)
function isRompevientos(product, parentChain) {
  // Check product name
  if (product.name.toLowerCase().includes('rompeviento')) return true;

  // Check parent chain
  for (const parent of parentChain) {
    if (parent.name.toLowerCase().includes('rompeviento')) return true;
  }

  return false;
}

// Get subdivision from parent chain (for products like Cinta Plástica, Cinta Rompevientos)
function getSubdivision(product, parentChain) {
  // Skip first parent (base class) and look for intermediate categories
  if (parentChain.length < 2) return null;

  // Check if any parent contains "rompeviento"
  const isCintaRompevientos = parentChain.some(p => p.name.toLowerCase().includes('rompeviento'));

  // Get intermediate parents (skip base class and direct parent if it's just a size/color)
  for (let i = 1; i < parentChain.length; i++) {
    const parent = parentChain[i];
    const nameLower = parent.name.toLowerCase();

    // For Cinta Rompevientos, ONLY include dimension classifiers (like "Rollo de 57 mm x 150 m")
    if (isCintaRompevientos) {
      // Match patterns with dimensions like "57 mm x 150 m" or "Rollo de..."
      if (nameLower.includes('rollo de') || /\d+\s*(mm|cm|m)\s*x/i.test(parent.name)) {
        return parent.name;
      }
      // Skip other parents for Cinta Rompevientos - we only want the dimension
      continue;
    }

    // Skip if it's a percentage, size, color, or common terms
    if (/^\d+%?$/.test(parent.name) ||
        nameLower.includes('medida') ||
        nameLower.includes('color') ||
        nameLower.includes('rollo') ||
        nameLower.includes('confeccionada')) {
      continue;
    }

    // This is likely a subdivision
    return parent.name;
  }

  return null;
}

// Check if product has triangular shape (3 sides)
function isTriangular(product, parentChain) {
  // Check product attributes
  if (product.attributes) {
    const side1 = product.attributes.side1 || product.attributes.get?.('side1');
    const side2 = product.attributes.side2 || product.attributes.get?.('side2');
    const side3 = product.attributes.side3 || product.attributes.get?.('side3');
    const side4 = product.attributes.side4 || product.attributes.get?.('side4');

    if (side1 && side2 && side3 && !side4) {
      return true;
    }
  }

  // Check parent chain
  for (let i = parentChain.length - 1; i >= 0; i--) {
    const parent = parentChain[i];
    if (parent.attributes) {
      const side1 = parent.attributes.side1 || parent.attributes.get?.('side1');
      const side2 = parent.attributes.side2 || parent.attributes.get?.('side2');
      const side3 = parent.attributes.side3 || parent.attributes.get?.('side3');
      const side4 = parent.attributes.side4 || parent.attributes.get?.('side4');

      if (side1 && side2 && side3 && !side4) {
        return true;
      }
    }
  }

  return false;
}

// Extract size information from product or parent chain
function extractSizeInfo(product, parentChain) {
  // Check product attributes first
  if (product.attributes) {
    // Check for 3 sides
    const side1 = product.attributes.side1 || product.attributes.get?.('side1');
    const side2 = product.attributes.side2 || product.attributes.get?.('side2');
    const side3 = product.attributes.side3 || product.attributes.get?.('side3');

    if (side1 && side2 && side3) {
      return `${side1}x${side2}x${side3}m`;
    }

    const width = product.attributes.width || product.attributes.get?.('width');
    const length = product.attributes.length || product.attributes.get?.('length');
    if (width && length) {
      return `${width}x${length}m`;
    }
  }

  // Check parent chain for size info
  for (let i = parentChain.length - 1; i >= 0; i--) {
    const parent = parentChain[i];

    // Check parent attributes for sides
    if (parent.attributes) {
      const side1 = parent.attributes.side1 || parent.attributes.get?.('side1');
      const side2 = parent.attributes.side2 || parent.attributes.get?.('side2');
      const side3 = parent.attributes.side3 || parent.attributes.get?.('side3');

      if (side1 && side2 && side3) {
        return `${side1}x${side2}x${side3}m`;
      }
    }

    if (parent.name.toLowerCase().includes('medida') || /\d+x\d+/.test(parent.name)) {
      // Extract dimensions from name
      const match = parent.name.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
      if (match) {
        return `${match[1]}x${match[2]}m`;
      }
      return parent.name.replace(/medida\s*/i, '');
    }
  }

  return '-';
}

// Extract color information from product name or parent chain
function extractColorInfo(product, parentChain) {
  const colorKeywords = ['negro', 'beige', 'verde', 'blanco', 'azul', 'rojo', 'gris', 'café', 'naranja'];

  // Check product name
  for (const color of colorKeywords) {
    if (product.name.toLowerCase().includes(color)) {
      return color.charAt(0).toUpperCase() + color.slice(1);
    }
  }

  // Check if product name starts with "Color"
  if (product.name.toLowerCase().startsWith('color ')) {
    return product.name.replace(/^color\s*/i, '');
  }

  return '-';
}

// Group products by their group key
function groupProducts(flatProducts) {
  const groups = {};

  for (const product of flatProducts) {
    if (!groups[product.groupKey]) {
      groups[product.groupKey] = {
        name: product.groupName,
        products: []
      };
    }
    groups[product.groupKey].products.push(product);
  }

  return groups;
}

function InventarioView() {
  const [productTree, setProductTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [bulkOperation, setBulkOperation] = useState('');
  const [bulkValue, setBulkValue] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  // ML Import modal state
  const [mlImportProduct, setMlImportProduct] = useState(null); // Product being linked
  const [mlItems, setMlItems] = useState([]);
  const [mlItemsLoading, setMlItemsLoading] = useState(false);
  const [mlSearchTerm, setMlSearchTerm] = useState('');
  const [mlLinking, setMlLinking] = useState(false);

  // ML Price Sync state
  const [mlSyncing, setMlSyncing] = useState(false);
  const [mlSyncResult, setMlSyncResult] = useState(null);

  const fetchProductTree = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/product-families/tree`);
      const data = await res.json();
      if (data.success) {
        setProductTree(data.data);
        // Expand all groups by default
        const flatProducts = flattenSellableProducts(data.data);
        const groups = groupProducts(flatProducts);
        setExpandedGroups(new Set(Object.keys(groups)));
      }
    } catch (error) {
      console.error('Error fetching product tree:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProductTree();
  }, []);

  // Helper to update a product in the tree by ID
  const updateProductInTree = (tree, productId, updates) => {
    return tree.map(node => {
      if (node._id === productId) {
        return { ...node, ...updates };
      }
      if (node.children && node.children.length > 0) {
        return { ...node, children: updateProductInTree(node.children, productId, updates) };
      }
      return node;
    });
  };

  const handleUpdateProduct = async (productId, field, value) => {
    // Optimistically update local state
    const updates = { [field]: value };
    setProductTree(prev => updateProductInTree(prev, productId, updates));

    try {
      const res = await fetch(`${API_URL}/product-families/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const data = await res.json();
      if (!data.success) {
        // Revert on error
        fetchProductTree();
        alert('Error al actualizar: ' + data.error);
      }
    } catch (error) {
      console.error('Error updating product:', error);
    }
  };

  const handleBulkUpdate = async () => {
    if (selectedItems.size === 0) {
      alert('Selecciona al menos un producto');
      return;
    }
    if (!bulkOperation) {
      alert('Selecciona una operación');
      return;
    }

    let updateData = {};
    if (bulkOperation === 'precio' && bulkValue) {
      updateData = { price: parseFloat(bulkValue) };
    } else if (bulkOperation === 'stock' && bulkValue) {
      updateData = { stock: parseInt(bulkValue) };
    } else if (bulkOperation === 'activar') {
      updateData = { active: true };
    } else if (bulkOperation === 'desactivar') {
      updateData = { active: false };
    } else {
      alert('Ingresa un valor válido');
      return;
    }

    // Save selected items before clearing
    const itemsToUpdate = Array.from(selectedItems);

    // Optimistically update local state
    setProductTree(prev => {
      let updated = prev;
      for (const id of itemsToUpdate) {
        updated = updateProductInTree(updated, id, updateData);
      }
      return updated;
    });

    setSelectedItems(new Set());
    setBulkOperation('');
    setBulkValue('');

    try {
      const results = await Promise.all(
        itemsToUpdate.map(id =>
          fetch(`${API_URL}/product-families/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
          })
        )
      );
      const hasError = results.some(r => !r.ok);
      if (hasError) {
        fetchProductTree();
        alert('Algunos productos no se pudieron actualizar');
      }
    } catch (error) {
      console.error('Error in bulk update:', error);
      fetchProductTree();
      alert('Error al actualizar');
    }
  };

  const toggleSelectAll = (groupProducts) => {
    const groupIds = groupProducts.map(p => p._id);
    const allSelected = groupIds.every(id => selectedItems.has(id));

    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (allSelected) {
        groupIds.forEach(id => newSet.delete(id));
      } else {
        groupIds.forEach(id => newSet.add(id));
      }
      return newSet;
    });
  };

  const toggleSelect = (productId) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(productId)) {
        newSet.delete(productId);
      } else {
        newSet.add(productId);
      }
      return newSet;
    });
  };

  const toggleGroup = (groupKey) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupKey)) {
        newSet.delete(groupKey);
      } else {
        newSet.add(groupKey);
      }
      return newSet;
    });
  };

  // Fetch ML items matching search term
  const searchMLItems = async (searchTerm) => {
    if (!searchTerm || searchTerm.length < 3) {
      setMlItems([]);
      return;
    }
    setMlItemsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/ml/items?search=${encodeURIComponent(searchTerm)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        // Filter to only active items
        const activeItems = (data.items || []).filter(item => item.status === 'active');
        setMlItems(activeItems);
      }
    } catch (error) {
      console.error('Error fetching ML items:', error);
    } finally {
      setMlItemsLoading(false);
    }
  };

  // Open ML import modal for a product
  const openMLImportModal = (product) => {
    setMlImportProduct(product);
    setMlSearchTerm('');
    setMlItems([]);
  };

  // Handle ML search with debounce
  const handleMLSearchChange = (value) => {
    setMlSearchTerm(value);
    // Debounce search
    clearTimeout(window.mlSearchTimeout);
    window.mlSearchTimeout = setTimeout(() => {
      searchMLItems(value);
    }, 300);
  };

  // Link ML item to product
  const linkMLToProduct = async (mlItem) => {
    if (!mlImportProduct) return;
    setMlLinking(true);
    try {
      const token = localStorage.getItem('token');
      const existingLinks = mlImportProduct.onlineStoreLinks || [];
      const newLinks = [
        ...existingLinks.filter(l => l.url !== mlItem.permalink),
        {
          url: `https://articulo.mercadolibre.com.mx/${mlItem.id.replace(/^(MLM)(\d+)$/, '$1-$2')}`,
          store: 'Mercado Libre',
          isPreferred: existingLinks.length === 0
        }
      ];

      const res = await fetch(`${API_URL}/product-families/${mlImportProduct._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          onlineStoreLinks: newLinks,
          price: mlItem.price
        })
      });

      const data = await res.json();
      if (data.success) {
        // Update local state
        setProductTree(prev => updateProductInTree(prev, mlImportProduct._id, {
          onlineStoreLinks: newLinks,
          price: mlItem.price
        }));
        setMlImportProduct(null);
        setMlSearchTerm('');
      } else {
        alert('Error al vincular: ' + data.error);
      }
    } catch (error) {
      console.error('Error linking ML item:', error);
      alert('Error al vincular producto');
    } finally {
      setMlLinking(false);
    }
  };

  // Sync ML prices for all products with ML links
  const syncMLPrices = async () => {
    setMlSyncing(true);
    setMlSyncResult(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/ml/sync-prices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.success) {
        setMlSyncResult({ synced: data.synced, errors: data.errors, skipped: data.skipped });
        // Refresh product tree to show updated mlPrice values
        fetchProductTree();
      } else {
        alert('Error al sincronizar precios: ' + data.error);
      }
    } catch (error) {
      console.error('Error syncing ML prices:', error);
      alert('Error al sincronizar precios de ML');
    } finally {
      setMlSyncing(false);
    }
  };

  // Deactivate all products without confirmed prices
  const deactivateUnconfirmedPrices = async () => {
    const flatProducts = flattenSellableProducts(productTree);
    const productsToDeactivate = flatProducts.filter(p => p.priceIsInherited || !p.inheritedPrice || p.inheritedPrice <= 0);

    if (productsToDeactivate.length === 0) {
      alert('No hay productos con precios sin confirmar');
      return;
    }

    if (!window.confirm(`¿Desactivar ${productsToDeactivate.length} productos sin precio confirmado?`)) {
      return;
    }

    const idsToDeactivate = productsToDeactivate.map(p => p._id);

    // Optimistic update
    setProductTree(prev => {
      let updated = prev;
      for (const id of idsToDeactivate) {
        updated = updateProductInTree(updated, id, { active: false });
      }
      return updated;
    });

    try {
      await Promise.all(
        idsToDeactivate.map(id =>
          fetch(`${API_URL}/product-families/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: false })
          })
        )
      );
    } catch (error) {
      console.error('Error deactivating products:', error);
      fetchProductTree();
      alert('Error al desactivar productos');
    }
  };

  // Flatten and group products
  const flatProducts = flattenSellableProducts(productTree);
  const groups = groupProducts(flatProducts);

  // Filter by search term
  const filteredGroups = Object.entries(groups).reduce((acc, [key, group]) => {
    const filteredProducts = group.products.filter(p =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sizeInfo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.colorInfo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      group.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    if (filteredProducts.length > 0) {
      acc[key] = { ...group, products: filteredProducts };
    }
    return acc;
  }, {});

  const totalProducts = Object.values(filteredGroups).reduce((sum, g) => sum + g.products.length, 0);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Inventario</h1>
        <p className="text-gray-400 text-sm mt-1">
          {totalProducts} productos vendibles
        </p>
      </div>

      {/* Search and Bulk Controls */}
      <div className="mb-4 flex flex-wrap gap-4 items-center">
        {/* Search */}
        <div className="flex-1 min-w-64">
          <input
            type="text"
            placeholder="Buscar por nombre, medida o color..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary-500"
          />
        </div>

        {/* ML Price Sync */}
        <button
          onClick={syncMLPrices}
          disabled={mlSyncing}
          className="px-4 py-2 bg-yellow-500/20 border border-yellow-500/50 text-yellow-300 rounded-lg hover:bg-yellow-500/30 transition-colors text-sm font-medium disabled:opacity-50 flex items-center gap-2"
          title="Sincronizar precios desde Mercado Libre"
        >
          {mlSyncing ? (
            <>
              <div className="w-4 h-4 border-2 border-yellow-300 border-t-transparent rounded-full animate-spin"></div>
              Sincronizando...
            </>
          ) : (
            'Sync ML'
          )}
        </button>
        {mlSyncResult && (
          <span className="text-xs text-gray-400">
            {mlSyncResult.synced} sincronizados
            {mlSyncResult.errors > 0 && <span className="text-red-400">, {mlSyncResult.errors} errores</span>}
          </span>
        )}

        {/* Deactivate unconfirmed prices */}
        <button
          onClick={deactivateUnconfirmedPrices}
          className="px-4 py-2 bg-amber-500/20 border border-amber-500/50 text-amber-300 rounded-lg hover:bg-amber-500/30 transition-colors text-sm font-medium"
          title="Desactivar productos con precios heredados (amarillo)"
        >
          Desactivar sin precio
        </button>

        {/* Bulk Operations */}
        {selectedItems.size > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-primary-500/10 border border-primary-500/30 rounded-lg">
            <span className="text-sm text-primary-300 font-medium">
              {selectedItems.size} seleccionados
            </span>
            <select
              value={bulkOperation}
              onChange={(e) => { setBulkOperation(e.target.value); setBulkValue(''); }}
              className="px-2 py-1 bg-gray-900 border border-gray-700 rounded text-white text-sm"
            >
              <option value="">Operación...</option>
              <option value="precio">Precio</option>
              <option value="stock">Stock</option>
              <option value="activar">Activar</option>
              <option value="desactivar">Desactivar</option>
            </select>
            {(bulkOperation === 'precio' || bulkOperation === 'stock') && (
              <input
                type="number"
                step={bulkOperation === 'precio' ? '0.01' : '1'}
                placeholder={bulkOperation === 'precio' ? 'Precio' : 'Stock'}
                value={bulkValue}
                onChange={(e) => setBulkValue(e.target.value)}
                className="px-2 py-1 bg-gray-900 border border-gray-700 rounded text-white text-sm w-24"
              />
            )}
            <button
              onClick={handleBulkUpdate}
              className="px-3 py-1 bg-primary-500 text-white rounded hover:bg-primary-600 text-sm font-medium"
            >
              Aplicar
            </button>
          </div>
        )}
      </div>

      {/* Product Tables by Group */}
      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-400 mt-4">Cargando inventario...</p>
        </div>
      ) : Object.keys(filteredGroups).length === 0 ? (
        <div className="text-center py-12 bg-gray-800/30 rounded-lg">
          <p className="text-gray-400">No se encontraron productos</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(filteredGroups).map(([groupKey, group]) => {
            const isExpanded = expandedGroups.has(groupKey);
            const groupProductIds = group.products.map(p => p._id);
            const allSelected = groupProductIds.every(id => selectedItems.has(id));
            const someSelected = groupProductIds.some(id => selectedItems.has(id));

            return (
              <div key={groupKey} className="bg-gray-800/50 border border-gray-700/50 rounded-lg overflow-hidden">
                {/* Group Header */}
                <button
                  onClick={() => toggleGroup(groupKey)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/80 hover:bg-gray-700/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <svg
                      className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="font-semibold text-white">{group.name}</span>
                    <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">
                      {group.products.length} productos
                    </span>
                  </div>
                </button>

                {/* Table */}
                {isExpanded && (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-900/50">
                        <tr>
                          <th className="px-3 py-2 text-left w-10">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              ref={el => el && (el.indeterminate = someSelected && !allSelected)}
                              onChange={() => toggleSelectAll(group.products)}
                              className="rounded border-gray-600 text-primary-500"
                            />
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Producto</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase w-24">Medida</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase w-20">Color</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase w-20">Stock</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase w-28">Precio</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase w-20">Min Qty</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase w-28">Mayoreo</th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-400 uppercase w-20">Activo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-700/30">
                        {group.products.map((product) => (
                          <tr key={product._id} className="hover:bg-gray-700/20 transition-colors">
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={selectedItems.has(product._id)}
                                onChange={() => toggleSelect(product._id)}
                                className="rounded border-gray-600 text-primary-500"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-white">
                                  {product.productType &&
                                   !product.groupName.toLowerCase().includes(product.productType.toLowerCase()) &&
                                   !product.groupName.toLowerCase().includes('cinta') &&
                                   !product.name.toLowerCase().includes(product.productType.toLowerCase()) && (
                                    <span className="text-cyan-400 mr-1">{product.productType}</span>
                                  )}
                                  {product.shadePercentage && <span className="text-cyan-300 mr-1">{product.shadePercentage}</span>}
                                  {product.reinforcementType && <span className="text-purple-400 mr-1">{product.reinforcementType}</span>}
                                  {product.isTriangular && product.productType !== 'Confeccionada' && <span className="text-amber-400 mr-1">Triangular</span>}
                                  {product.isRompevientos && <span className="text-sky-400 mr-1">Rompevientos</span>}
                                  {product.subdivision && <span className="text-green-400 mr-1">{product.subdivision}</span>}
                                  {product.name}
                                </span>
                                {(() => {
                                  // Only show ML button for valid ML links with real item IDs (MLM-XXXXXXXXX)
                                  const mlLink = product.onlineStoreLinks?.find(l =>
                                    l.url?.includes('mercadolibre') && /MLM[-]?\d{6,}/.test(l.url)
                                  )?.url;
                                  return (
                                    <div className="flex items-center gap-1">
                                      {mlLink ? (
                                        <>
                                          <a
                                            href={mlLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center px-1.5 py-0.5 bg-yellow-500/20 hover:bg-yellow-500/40 text-yellow-400 text-xs font-medium rounded transition-colors"
                                            title={mlLink}
                                          >
                                            ML
                                          </a>
                                          <button
                                            onClick={() => openMLImportModal(product)}
                                            className="inline-flex items-center p-0.5 text-gray-500 hover:text-yellow-400 transition-colors"
                                            title="Cambiar enlace ML"
                                          >
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                            </svg>
                                          </button>
                                        </>
                                      ) : (
                                        <button
                                          onClick={() => openMLImportModal(product)}
                                          className="inline-flex items-center px-1.5 py-0.5 bg-gray-600/50 hover:bg-yellow-500/30 text-gray-400 hover:text-yellow-400 text-xs font-medium rounded transition-colors"
                                          title="Importar desde ML"
                                        >
                                          +ML
                                        </button>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <span className="text-sm text-gray-300 font-mono">{product.sizeInfo}</span>
                            </td>
                            <td className="px-3 py-2">
                              <span className="text-sm text-gray-300">{product.colorInfo}</span>
                            </td>
                            <td className="px-3 py-2">
                              <EditableCell
                                value={product.stock || 0}
                                onSave={(v) => handleUpdateProduct(product._id, 'stock', parseInt(v))}
                                type="number"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1">
                                <EditableCell
                                  value={product.inheritedPrice || 0}
                                  onSave={(v) => handleUpdateProduct(product._id, 'price', parseFloat(v))}
                                  type="number"
                                  step="0.01"
                                  inherited={product.priceIsInherited}
                                />
                                {product.priceIsInherited && product.inheritedPrice > 0 && (
                                  <button
                                    onClick={() => handleUpdateProduct(product._id, 'price', product.inheritedPrice)}
                                    className="p-1 text-amber-400 hover:text-green-400 border border-amber-400/50 hover:border-green-400 hover:bg-green-500/20 rounded transition-colors"
                                    title="Confirmar precio"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                  </button>
                                )}
                                {/* ML Price discrepancy indicator */}
                                {product.hasMLPrice && product.mlPriceDiscrepancy !== null && product.mlPriceDiscrepancy !== 0 && (
                                  <span
                                    className={`text-xs px-1.5 py-0.5 rounded ${
                                      product.mlPriceDiscrepancy > 0
                                        ? 'bg-green-500/20 text-green-400'
                                        : 'bg-red-500/20 text-red-400'
                                    }`}
                                    title={`ML: $${product.mlPrice?.toLocaleString()} | Diferencia: ${product.mlPriceDiscrepancy > 0 ? '+' : ''}$${product.mlPriceDiscrepancy.toLocaleString()}`}
                                  >
                                    {product.mlPriceDiscrepancy > 0 ? '+' : ''}{Math.round(product.mlPriceDiscrepancy)}
                                  </span>
                                )}
                                {product.hasMLPrice && product.mlPriceDiscrepancy === 0 && (
                                  <span
                                    className="text-xs px-1 text-green-400"
                                    title={`Precio sincronizado con ML: $${product.mlPrice?.toLocaleString()}`}
                                  >
                                    =ML
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <EditableCell
                                value={product.wholesaleMinQty || ''}
                                onSave={(v) => handleUpdateProduct(product._id, 'wholesaleMinQty', v ? parseInt(v) : null)}
                                type="number"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <EditableCell
                                value={product.wholesalePrice || 0}
                                onSave={(v) => handleUpdateProduct(product._id, 'wholesalePrice', parseFloat(v))}
                                type="number"
                                step="0.01"
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={() => handleUpdateProduct(product._id, 'active', !(product.active ?? true))}
                                className={`w-8 h-5 rounded-full transition-colors ${
                                  (product.active ?? true) ? 'bg-green-500' : 'bg-gray-600'
                                }`}
                              >
                                <span className={`block w-3 h-3 rounded-full bg-white transition-transform ${
                                  (product.active ?? true) ? 'translate-x-4' : 'translate-x-1'
                                }`} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ML Import Modal */}
      {mlImportProduct && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            {/* Modal Header */}
            <div className="p-4 border-b border-gray-700">
              <h2 className="text-lg font-semibold text-white">Importar desde Mercado Libre</h2>
              <p className="text-sm text-gray-400 mt-1">
                Vinculando: <span className="text-white">{mlImportProduct.name}</span>
              </p>
            </div>

            {/* Search */}
            <div className="p-4 border-b border-gray-700">
              <input
                type="text"
                placeholder="Escribe al menos 3 caracteres para buscar..."
                value={mlSearchTerm}
                onChange={(e) => handleMLSearchChange(e.target.value)}
                autoFocus
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary-500"
              />
            </div>

            {/* ML Items List */}
            <div className="flex-1 overflow-y-auto p-4">
              {mlSearchTerm.length < 3 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500">Escribe al menos 3 caracteres para buscar productos en ML</p>
                </div>
              ) : mlItemsLoading ? (
                <div className="text-center py-8">
                  <div className="inline-block w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-gray-400 mt-2">Buscando...</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {mlItems.slice(0, 30).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 p-3 bg-gray-900/50 rounded-lg"
                    >
                      {item.thumbnail && (
                        <img
                          src={item.thumbnail}
                          alt={item.title}
                          className="w-12 h-12 object-cover rounded bg-gray-700"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm truncate">{item.title}</p>
                        <p className="text-yellow-400 font-semibold">${item.price?.toLocaleString()}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <a
                          href={`https://articulo.mercadolibre.com.mx/${item.id.replace(/^(MLM)(\d+)$/, '$1-$2')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/20 rounded transition-colors"
                        >
                          Ver
                        </a>
                        <button
                          onClick={() => linkMLToProduct(item)}
                          disabled={mlLinking}
                          className="px-3 py-1 bg-primary-500 text-white text-sm rounded hover:bg-primary-600 transition-colors disabled:opacity-50"
                        >
                          Vincular
                        </button>
                      </div>
                    </div>
                  ))}
                  {mlItems.length > 30 && (
                    <p className="text-center text-gray-500 text-sm py-2">
                      Mostrando 30 de {mlItems.length} resultados
                    </p>
                  )}
                  {mlItems.length === 0 && !mlItemsLoading && mlSearchTerm.length >= 3 && (
                    <p className="text-center text-gray-500 py-4">No se encontraron productos</p>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-700">
              <button
                onClick={() => { setMlImportProduct(null); setMlSearchTerm(''); }}
                className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default InventarioView;
