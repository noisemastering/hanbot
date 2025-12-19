import React, { useState, useEffect } from 'react';
import API from '../api';

function ProductFamilyModal({ product, allProducts, onSave, onClose, presetParentId }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    marketingDescription: '',
    parentId: '',
    sellable: false,
    price: '',
    sku: '',
    stock: '',
    requiresHumanAdvisor: false,
    genericDescription: '',
    thumbnail: '',
    onlineStoreLinks: []
  });

  // State for importing links from old products
  const [showImportModal, setShowImportModal] = useState(false);
  const [oldProducts, setOldProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(false);

  // State for Points of Sale
  const [pointsOfSale, setPointsOfSale] = useState([]);
  const [loadingPOS, setLoadingPOS] = useState(false);

  useEffect(() => {
    if (product) {
      setFormData({
        name: product.name || '',
        description: product.description || '',
        marketingDescription: product.marketingDescription || '',
        parentId: product.parentId || '',
        sellable: product.sellable || false,
        price: product.price || '',
        sku: product.sku || '',
        stock: product.stock || '',
        requiresHumanAdvisor: product.requiresHumanAdvisor || false,
        genericDescription: product.genericDescription || '',
        thumbnail: product.thumbnail || '',
        onlineStoreLinks: product.onlineStoreLinks || []
      });
    } else if (presetParentId) {
      // When adding a child, preset the parent
      setFormData(prev => ({
        ...prev,
        parentId: presetParentId
      }));
    }
  }, [product, presetParentId]);

  // Fetch Points of Sale when component mounts
  useEffect(() => {
    const fetchPointsOfSale = async () => {
      setLoadingPOS(true);
      try {
        const response = await API.get('/points-of-sale?active=true');
        if (response.data.success) {
          setPointsOfSale(response.data.data || []);
        }
      } catch (error) {
        console.error('Error fetching points of sale:', error);
      } finally {
        setLoadingPOS(false);
      }
    };
    fetchPointsOfSale();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prepare data for submission
    const submitData = {
      name: formData.name,
      description: formData.description,
      marketingDescription: formData.marketingDescription || null,
      parentId: formData.parentId || null,
      sellable: formData.sellable
    };

    // Only include price if it has a value (don't send null to avoid overwriting existing prices)
    if (formData.price !== null && formData.price !== undefined && formData.price !== '') {
      submitData.price = parseFloat(formData.price);
    }

    // Only include sellable-specific fields if product is sellable
    if (formData.sellable) {
      submitData.sku = formData.sku || null;
      submitData.stock = formData.stock ? parseInt(formData.stock, 10) : null;
      submitData.requiresHumanAdvisor = Boolean(formData.requiresHumanAdvisor);
      submitData.genericDescription = formData.genericDescription || null;
      submitData.thumbnail = formData.thumbnail || null;
      submitData.onlineStoreLinks = formData.onlineStoreLinks || [];
    } else {
      // Clear sellable-specific fields when product is not sellable
      submitData.requiresHumanAdvisor = false;
      submitData.genericDescription = null;
      submitData.thumbnail = null;
      submitData.onlineStoreLinks = [];
    }

    console.log('📤 Submitting product family data:');
    console.log('   Name:', submitData.name);
    console.log('   Sellable:', submitData.sellable);
    console.log('   Price:', submitData.price);
    console.log('   onlineStoreLinks:', submitData.onlineStoreLinks);
    console.log('   Full data:', JSON.stringify(submitData, null, 2));

    // Call the parent save handler
    await onSave(submitData);

    // Automatically bulk update children prices if:
    // 1. This product is being edited (has an ID)
    // 2. Price was provided in the form
    // 3. Product has children (check will be done on backend)
    if (product && product._id && submitData.price) {
      try {
        console.log(`🏷️  Auto-updating children prices for product ${product._id} to $${submitData.price}`);
        const response = await API.post(`/product-families/${product._id}/bulk-update-price`, {
          price: submitData.price
        });

        if (response.data.success && response.data.updatedCount > 0) {
          console.log(`✅ ${response.data.message}`);
          // Show success message only if some products were actually updated
          alert(`Actualizado: ${response.data.updatedCount} productos descendientes actualizados con el precio $${submitData.price}`);
        }
      } catch (error) {
        console.error('Error bulk updating prices:', error);
        // Don't show error alert - this is automatic and shouldn't interrupt the flow
      }
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;

    // If parentId is being changed to empty and sellable is true, uncheck sellable
    if (name === 'parentId' && !value && formData.sellable) {
      setFormData({
        ...formData,
        parentId: value,
        sellable: false
      });
      return;
    }

    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value
    });
  };

  // Get flat list of all products for parent dropdown
  const flattenProducts = (products, level = 0) => {
    let result = [];
    products.forEach(prod => {
      result.push({ ...prod, level });
      if (prod.children && prod.children.length > 0) {
        result = result.concat(flattenProducts(prod.children, level + 1));
      }
    });
    return result;
  };

  const flatProducts = allProducts ? flattenProducts(allProducts) : [];

  // Filter out the current product and its descendants from parent options
  const availableParents = product
    ? flatProducts.filter(p => p._id !== product._id && !isDescendant(p, product._id, allProducts))
    : flatProducts;

  // Helper to check if a product is a descendant of another
  function isDescendant(productToCheck, ancestorId, products) {
    if (!productToCheck.parentId) return false;
    if (productToCheck.parentId === ancestorId) return true;

    const parent = flatProducts.find(p => p._id === productToCheck.parentId);
    if (!parent) return false;

    return isDescendant(parent, ancestorId, products);
  }

  // Fetch old products from /products collection
  const fetchOldProducts = async () => {
    setLoadingProducts(true);
    try {
      const response = await API.get('/products');
      if (response.data.success) {
        setOldProducts(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching old products:', error);
    } finally {
      setLoadingProducts(false);
    }
  };

  // Import mLink from selected old product
  const handleImportLink = (oldProduct) => {
    if (oldProduct.mLink) {
      // Check if Mercado Libre link already exists
      const hasMLLink = formData.onlineStoreLinks.some(
        link => link.store === 'Mercado Libre'
      );

      if (hasMLLink) {
        // Update existing Mercado Libre link
        const newLinks = formData.onlineStoreLinks.map(link =>
          link.store === 'Mercado Libre'
            ? { ...link, url: oldProduct.mLink, isPreferred: true }
            : { ...link, isPreferred: false }
        );
        setFormData({ ...formData, onlineStoreLinks: newLinks });
      } else {
        // Add new Mercado Libre link as preferred
        const newLinks = formData.onlineStoreLinks.map(l => ({ ...l, isPreferred: false }));
        newLinks.push({
          url: oldProduct.mLink,
          store: 'Mercado Libre',
          isPreferred: true
        });
        setFormData({ ...formData, onlineStoreLinks: newLinks });
      }

      setShowImportModal(false);
      setSearchTerm('');
    }
  };

  // Open import modal and fetch products
  const openImportModal = () => {
    setShowImportModal(true);
    if (oldProducts.length === 0) {
      fetchOldProducts();
    }
  };

  // Filter products by search term - show all if no search term
  const filteredOldProducts = !searchTerm
    ? oldProducts
    : oldProducts.filter(p => {
        const searchLower = searchTerm.toLowerCase();
        // Combine name and size for matching full product names like "Malla Sombra Beige 6x7m"
        const fullName = `${p.name || ''} ${p.size || ''}`.toLowerCase();
        return (
          fullName.includes(searchLower) ||
          p.name?.toLowerCase().includes(searchLower) ||
          p.size?.toLowerCase().includes(searchLower) ||
          p.description?.toLowerCase().includes(searchLower)
        );
      });

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">
            {product ? 'Editar Familia de Productos' : 'Nueva Familia de Productos'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:bg-gray-700/50 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            {/* Name Field */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Nombre *
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Ej: Malla Sombra Raschel, Bordes"
              />
            </div>

            {/* Specifications Field */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Especificaciones
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows={3}
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Especificaciones técnicas del producto (medidas, materiales, características, etc.)..."
              />
            </div>

            {/* Marketing Description Field */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Descripción de Marketing
              </label>
              <textarea
                name="marketingDescription"
                value={formData.marketingDescription}
                onChange={handleChange}
                rows={3}
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Texto promocional o de marketing para este producto..."
              />
              <p className="text-xs text-gray-500 mt-1">
                Contenido promocional que se utilizará en campañas de marketing
              </p>
            </div>

            {/* Parent Dropdown */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Producto Padre
              </label>
              <select
                name="parentId"
                value={formData.parentId}
                onChange={handleChange}
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Ninguno (Producto Raíz)</option>
                {availableParents.map((parent) => (
                  <option key={parent._id} value={parent._id}>
                    {'—'.repeat(parent.level)} {parent.name} (Gen {parent.generation || 1})
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Selecciona un padre para crear un producto hijo en el árbol familiar
              </p>
            </div>

            {/* Sellable Checkbox */}
            <div className="p-4 bg-gray-900/30 rounded-lg border border-gray-700/50">
              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="sellable"
                  name="sellable"
                  checked={formData.sellable}
                  onChange={handleChange}
                  disabled={!formData.parentId}
                  className="w-5 h-5 text-primary-500 bg-gray-900 border-gray-700 rounded focus:ring-primary-500 focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <label htmlFor="sellable" className={`text-sm font-medium cursor-pointer ${!formData.parentId ? 'text-gray-500' : 'text-gray-300'}`}>
                  Este producto es vendible (puede ofrecerse en campañas)
                </label>
              </div>
              {!formData.parentId && (
                <p className="text-xs text-amber-400 mt-2 flex items-center space-x-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>Los productos raíz no pueden ser vendibles. Selecciona un producto padre primero.</span>
                </p>
              )}
            </div>

            {/* Price Field - Available for both sellable and non-sellable products */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Precio
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400">$</span>
                <input
                  type="number"
                  name="price"
                  value={formData.price}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  className="w-full pl-8 pr-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="0.00"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Los productos no vendibles pueden tener precio para aplicarlo a todos sus hijos
              </p>
            </div>

            {/* Sellable-Only Fields */}
            {formData.sellable && (
              <div className="space-y-4 p-4 bg-green-500/5 rounded-lg border border-green-500/20">
                <div className="flex items-center space-x-2 mb-3">
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h3 className="text-sm font-semibold text-green-300">Detalles del Producto Vendible</h3>
                </div>

                {/* SKU */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    SKU
                  </label>
                  <input
                    type="text"
                    name="sku"
                    value={formData.sku}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="Ej: PROD-001"
                  />
                </div>

                {/* Stock */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Inventario
                  </label>
                  <input
                    type="number"
                    name="stock"
                    value={formData.stock}
                    onChange={handleChange}
                    min="0"
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="0"
                  />
                </div>

                {/* Generic Description for Cross-Selling */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Descripción Genérica (Cross-Selling)
                  </label>
                  <textarea
                    name="genericDescription"
                    value={formData.genericDescription}
                    onChange={handleChange}
                    rows={2}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="Ej: ideal para control de maleza en cultivos"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Descripción breve que se mostrará cuando el cliente pregunte por este producto
                  </p>
                </div>

                {/* Requires Human Advisor Checkbox */}
                <div className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      id="requiresHumanAdvisor"
                      name="requiresHumanAdvisor"
                      checked={formData.requiresHumanAdvisor}
                      onChange={handleChange}
                      className="w-5 h-5 text-amber-500 bg-gray-900 border-gray-700 rounded focus:ring-amber-500 focus:ring-2"
                    />
                    <label htmlFor="requiresHumanAdvisor" className="text-sm font-medium text-gray-300 cursor-pointer">
                      Requiere asesor humano
                    </label>
                  </div>
                  <p className="text-xs text-gray-500 mt-2 ml-8">
                    Cuando se marque, el bot ofrecerá conectar al cliente con un asesor humano al preguntar por este producto
                  </p>
                </div>

                {/* Thumbnail */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Miniatura (Thumbnail)
                  </label>
                  <input
                    type="url"
                    name="thumbnail"
                    value={formData.thumbnail}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="https://ejemplo.com/imagen-miniatura.jpg"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    URL de la imagen miniatura del producto
                  </p>
                </div>

                {/* Online Store Links */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Enlaces a Tiendas Online
                  </label>
                  {formData.onlineStoreLinks.map((link, index) => (
                    <div key={index} className="flex items-start space-x-2 mb-2 p-3 bg-gray-900/30 rounded-lg border border-gray-700/50">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center space-x-2">
                          <input
                            type="url"
                            value={link.url}
                            onChange={(e) => {
                              const newLinks = [...formData.onlineStoreLinks];
                              newLinks[index].url = e.target.value;
                              setFormData({ ...formData, onlineStoreLinks: newLinks });
                            }}
                            className="flex-1 px-3 py-1.5 bg-gray-900/50 border border-gray-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                            placeholder="https://..."
                          />
                          {link.url && (
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 bg-primary-500/20 text-primary-400 hover:bg-primary-500/30 rounded transition-colors flex-shrink-0"
                              title="Abrir enlace en nueva pestaña"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </a>
                          )}
                        </div>
                        <div className="flex items-center space-x-2">
                          <select
                            value={link.store}
                            onChange={(e) => {
                              const selectedStore = e.target.value;
                              const pos = pointsOfSale.find(p => p.name === selectedStore);
                              const newLinks = [...formData.onlineStoreLinks];
                              newLinks[index].store = selectedStore;
                              // Auto-fill URL from POS defaultUrl if available and current URL is empty
                              if (pos && pos.defaultUrl && !newLinks[index].url) {
                                newLinks[index].url = pos.defaultUrl;
                              }
                              setFormData({ ...formData, onlineStoreLinks: newLinks });
                            }}
                            className="flex-1 px-3 py-1.5 bg-gray-900/50 border border-gray-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                          >
                            <option value="">-- Seleccionar tienda --</option>
                            {pointsOfSale.map((pos) => (
                              <option key={pos._id} value={pos.name}>
                                {pos.icon ? `${pos.icon} ` : ''}{pos.name}
                              </option>
                            ))}
                          </select>
                          <label className="flex items-center space-x-1.5 text-sm text-gray-300 whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={link.isPreferred}
                              onChange={(e) => {
                                const newLinks = formData.onlineStoreLinks.map((l, i) => ({
                                  ...l,
                                  isPreferred: i === index ? e.target.checked : false
                                }));
                                setFormData({ ...formData, onlineStoreLinks: newLinks });
                              }}
                              className="w-4 h-4 text-primary-500 bg-gray-900 border-gray-700 rounded focus:ring-primary-500"
                            />
                            <span>Principal</span>
                          </label>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const newLinks = formData.onlineStoreLinks.filter((_, i) => i !== index);
                          setFormData({ ...formData, onlineStoreLinks: newLinks });
                        }}
                        className="p-1.5 text-red-400 hover:bg-red-500/10 rounded transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setFormData({
                          ...formData,
                          onlineStoreLinks: [...formData.onlineStoreLinks, { url: '', store: '', isPreferred: false }]
                        });
                      }}
                      className="px-4 py-2 bg-gray-900/50 border border-dashed border-gray-600 rounded-lg text-gray-400 hover:text-white hover:border-primary-500 transition-colors flex items-center justify-center space-x-2"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      <span>Agregar enlace</span>
                    </button>
                    <button
                      type="button"
                      onClick={openImportModal}
                      className="px-4 py-2 bg-primary-500/10 border border-dashed border-primary-500/50 rounded-lg text-primary-400 hover:text-primary-300 hover:border-primary-500 transition-colors flex items-center justify-center space-x-2"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                      </svg>
                      <span>Importar de Productos</span>
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Agrega enlaces manualmente o importa el link de Mercado Libre desde los productos existentes
                  </p>
                </div>
              </div>
            )}
          </div>
        </form>

        <div className="px-6 py-4 border-t border-gray-700/50 flex justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
          >
            {product ? 'Actualizar' : 'Crear'} Familia de Productos
          </button>
        </div>
      </div>

      {/* Import Link Modal */}
      {showImportModal && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-10 flex items-center justify-center p-4">
          <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">
                  Importar Link de Mercado Libre
                </h3>
                {formData.name && (
                  <div className="mt-2 px-3 py-1.5 bg-primary-500/20 border border-primary-500/30 rounded-lg inline-block">
                    <span className="text-xs text-gray-400">Buscando link para: </span>
                    <span className="text-sm font-medium text-primary-300">{formData.name}</span>
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-2">
                  {oldProducts.length} productos disponibles
                  {searchTerm && ` • ${filteredOldProducts.length} encontrados`}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setSearchTerm('');
                }}
                className="p-2 rounded-lg text-gray-400 hover:bg-gray-700/50 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 border-b border-gray-700/50">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por nombre, tamaño o descripción..."
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loadingProducts ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-gray-400">Cargando productos...</div>
                </div>
              ) : filteredOldProducts.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-gray-400">
                    {searchTerm ? 'No se encontraron productos con ese criterio' : 'No hay productos disponibles'}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredOldProducts.map((oldProd) => (
                    <button
                      key={oldProd._id}
                      onClick={() => handleImportLink(oldProd)}
                      disabled={!oldProd.mLink}
                      className={`w-full text-left p-4 rounded-lg border transition-colors ${
                        oldProd.mLink
                          ? 'bg-gray-900/30 border-gray-700/50 hover:bg-gray-700/30 hover:border-primary-500/50 cursor-pointer'
                          : 'bg-gray-900/10 border-gray-700/30 opacity-50 cursor-not-allowed'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-medium text-white">
                            {oldProd.name} {oldProd.size && `(${oldProd.size})`}
                          </div>
                          {oldProd.description && (
                            <div className="text-sm text-gray-400 mt-1">
                              {oldProd.description}
                            </div>
                          )}
                          {oldProd.mLink && (
                            <div className="text-xs text-primary-400 mt-2 truncate">
                              {oldProd.mLink}
                            </div>
                          )}
                        </div>
                        {oldProd.mLink ? (
                          <div className="ml-4 px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded flex items-center space-x-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                            <span>Con Link</span>
                          </div>
                        ) : !formData.requiresHumanAdvisor ? (
                          <div className="ml-4 px-2 py-1 bg-yellow-500/20 text-yellow-400 text-xs rounded flex items-center space-x-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <span>Sin Link</span>
                          </div>
                        ) : (
                          <div className="ml-4 px-2 py-1 bg-gray-700/50 text-gray-500 text-xs rounded flex items-center space-x-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" />
                            </svg>
                            <span>Sin Link</span>
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-700/50 flex justify-end">
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setSearchTerm('');
                }}
                className="px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
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

export default ProductFamilyModal;
