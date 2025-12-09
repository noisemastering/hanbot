import React, { useState, useEffect } from 'react';

function ProductFamilyModal({ product, allProducts, onSave, onClose, presetParentId }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    parentId: '',
    sellable: false,
    price: '',
    sku: '',
    stock: '',
    requiresHumanAdvisor: false,
    genericDescription: ''
  });

  useEffect(() => {
    if (product) {
      setFormData({
        name: product.name || '',
        description: product.description || '',
        parentId: product.parentId || '',
        sellable: product.sellable || false,
        price: product.price || '',
        sku: product.sku || '',
        stock: product.stock || '',
        requiresHumanAdvisor: product.requiresHumanAdvisor || false,
        genericDescription: product.genericDescription || ''
      });
    } else if (presetParentId) {
      // When adding a child, preset the parent
      setFormData(prev => ({
        ...prev,
        parentId: presetParentId
      }));
    }
  }, [product, presetParentId]);

  const handleSubmit = (e) => {
    e.preventDefault();

    // Prepare data for submission
    const submitData = {
      name: formData.name,
      description: formData.description,
      parentId: formData.parentId || null,
      sellable: formData.sellable
    };

    // Only include sellable fields if product is sellable
    if (formData.sellable) {
      submitData.price = formData.price ? parseFloat(formData.price) : null;
      submitData.sku = formData.sku || null;
      submitData.stock = formData.stock ? parseInt(formData.stock, 10) : null;
      submitData.requiresHumanAdvisor = formData.requiresHumanAdvisor;
      submitData.genericDescription = formData.genericDescription || null;
    }

    onSave(submitData);
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

            {/* Description Field */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Descripción
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows={3}
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Descripción de esta familia de productos..."
              />
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

            {/* Sellable-Only Fields */}
            {formData.sellable && (
              <div className="space-y-4 p-4 bg-green-500/5 rounded-lg border border-green-500/20">
                <div className="flex items-center space-x-2 mb-3">
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h3 className="text-sm font-semibold text-green-300">Detalles del Producto Vendible</h3>
                </div>

                {/* Price */}
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
    </div>
  );
}

export default ProductFamilyModal;
