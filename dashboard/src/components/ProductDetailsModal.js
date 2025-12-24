import React from 'react';

// Available dimensions with their display labels and available units
const AVAILABLE_DIMENSIONS = {
  width: { label: 'Ancho', icon: '↔️' },
  length: { label: 'Largo', icon: '↕️' },
  height: { label: 'Alto', icon: '⬆️' },
  depth: { label: 'Profundidad', icon: '⤵️' },
  thickness: { label: 'Grosor', icon: '📏' },
  weight: { label: 'Peso', icon: '⚖️' },
  diameter: { label: 'Diámetro', icon: '⭕' },
  side1: { label: 'Lado 1', icon: '📐' },
  side2: { label: 'Lado 2', icon: '📐' },
  side3: { label: 'Lado 3', icon: '📐' },
  side4: { label: 'Lado 4', icon: '📐' },
  side5: { label: 'Lado 5', icon: '📐' },
  side6: { label: 'Lado 6', icon: '📐' }
};

function ProductDetailsModal({ product, onClose, parentChain = [] }) {
  if (!product) return null;

  // Helper: Get inherited price from parent chain
  const getInheritedPrice = () => {
    // Check if product has its own price
    if (product.price !== undefined && product.price !== null) {
      return { price: product.price, inherited: false };
    }

    // Walk up the parent chain to find a price
    for (let i = parentChain.length - 1; i >= 0; i--) {
      const parent = parentChain[i];
      if (parent.price !== undefined && parent.price !== null) {
        return { price: parent.price, inherited: true };
      }
    }

    return { price: null, inherited: false };
  };

  // Helper: Get all inherited dimensions from parent chain
  const getAllInheritedDimensions = () => {
    const inherited = new Set();

    // Add current product's enabled dimensions
    if (product.enabledDimensions) {
      product.enabledDimensions.forEach(dim => inherited.add(dim));
    }

    // Walk up the parent chain to collect all enabled dimensions
    if (parentChain && parentChain.length > 0) {
      for (let i = parentChain.length - 1; i >= 0; i--) {
        const parent = parentChain[i];
        if (parent.enabledDimensions) {
          parent.enabledDimensions.forEach(dim => inherited.add(dim));
        }
      }
    }

    return Array.from(inherited);
  };

  // Helper: Get inherited dimension units from parent chain
  const getAllInheritedDimensionUnits = () => {
    const inheritedUnits = {};

    // Walk up the parent chain from root to current product
    if (parentChain && parentChain.length > 0) {
      // Merge units from root to immediate parent (so closer parents override)
      for (let i = 0; i < parentChain.length; i++) {
        const parent = parentChain[i];
        if (parent.dimensionUnits) {
          const parentUnits = parent.dimensionUnits instanceof Map
            ? Object.fromEntries(parent.dimensionUnits)
            : parent.dimensionUnits;
          Object.assign(inheritedUnits, parentUnits);
        }
      }
    }

    // Current product's dimension units override inherited ones
    if (product.dimensionUnits) {
      const currentUnits = product.dimensionUnits instanceof Map
        ? Object.fromEntries(product.dimensionUnits)
        : product.dimensionUnits;
      Object.assign(inheritedUnits, currentUnits);
    }

    return inheritedUnits;
  };

  const priceInfo = getInheritedPrice();
  const allDimensions = getAllInheritedDimensions();
  const allDimensionUnits = getAllInheritedDimensionUnits();

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-500/20 rounded-lg">
              <svg className="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white">Detalles del Producto</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:bg-gray-700/50 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Nombre</label>
                <p className="text-lg font-semibold text-white">{product.name}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Generación</label>
                  <span className="inline-flex px-3 py-1 bg-blue-500/20 text-blue-300 rounded-lg text-sm font-medium">
                    Gen {product.generation || 1}
                  </span>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Estado</label>
                  {product.sellable ? (
                    <span className="inline-flex items-center space-x-1 px-3 py-1 bg-green-500/20 text-green-300 rounded-lg text-sm font-medium">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Vendible</span>
                    </span>
                  ) : (
                    <span className="inline-flex px-3 py-1 bg-gray-500/20 text-gray-300 rounded-lg text-sm font-medium">
                      No Vendible
                    </span>
                  )}
                </div>
              </div>

              {product.parentId && (
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Producto Padre</label>
                  <p className="text-white">{product.parentId.name || 'ID: ' + product.parentId}</p>
                </div>
              )}
            </div>

            {/* Price - Show inherited price if available */}
            {priceInfo.price !== null && (
              <div className={`p-4 rounded-lg border ${
                priceInfo.inherited
                  ? 'bg-amber-500/5 border-amber-500/20'
                  : 'bg-primary-500/5 border-primary-500/20'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">
                      Precio {priceInfo.inherited && <span className="text-amber-400">(heredado)</span>}
                    </label>
                    <p className={`text-3xl font-bold ${
                      priceInfo.inherited ? 'text-amber-400' : 'text-primary-400'
                    }`}>
                      ${priceInfo.price.toFixed(2)}
                    </p>
                  </div>
                  {!product.sellable && (
                    <div className="text-xs text-gray-400 max-w-xs text-right">
                      <p>Este precio se puede aplicar a todos los productos vendibles descendientes</p>
                    </div>
                  )}
                  {priceInfo.inherited && product.sellable && (
                    <div className="text-xs text-amber-300/80 max-w-xs text-right">
                      <p>Este precio se hereda de un producto padre en la jerarquía</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Sellable Product Details */}
            {product.sellable && (
              <div className="p-4 bg-green-500/5 rounded-lg border border-green-500/20 space-y-4">
                <h3 className="text-sm font-semibold text-green-300 flex items-center space-x-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  <span>Información de Venta</span>
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  {product.sku && (
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">SKU</label>
                      <p className="text-white font-mono">{product.sku}</p>
                    </div>
                  )}

                  {product.stock !== undefined && product.stock !== null && (
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Inventario</label>
                      <p className="text-white">{product.stock} unidades</p>
                    </div>
                  )}

                  {product.available !== undefined && (
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Disponibilidad</label>
                      <span className={`inline-flex px-3 py-1 rounded-lg text-sm font-medium ${
                        product.available
                          ? 'bg-green-500/20 text-green-300'
                          : 'bg-red-500/20 text-red-300'
                      }`}>
                        {product.available ? 'Disponible' : 'No Disponible'}
                      </span>
                    </div>
                  )}

                  {product.active !== undefined && (
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Activo</label>
                      <span className={`inline-flex px-3 py-1 rounded-lg text-sm font-medium ${
                        product.active
                          ? 'bg-green-500/20 text-green-300'
                          : 'bg-gray-500/20 text-gray-300'
                      }`}>
                        {product.active ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>
                  )}
                </div>

                {product.requiresHumanAdvisor && (
                  <div className="flex items-center space-x-2 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                    <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span className="text-sm text-amber-300 font-medium">Requiere asesor humano</span>
                  </div>
                )}
              </div>
            )}

            {/* Specifications */}
            {product.description && (
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Especificaciones</label>
                <div className="p-4 bg-gray-900/50 border border-gray-700 rounded-lg">
                  <p className="text-white whitespace-pre-wrap">{product.description}</p>
                </div>
              </div>
            )}

            {/* Marketing Description */}
            {product.marketingDescription && (
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Descripción de Marketing</label>
                <div className="p-4 bg-primary-500/5 border border-primary-500/20 rounded-lg">
                  <p className="text-white whitespace-pre-wrap">{product.marketingDescription}</p>
                </div>
              </div>
            )}

            {/* Generic Description */}
            {product.genericDescription && (
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Descripción Genérica (Cross-Selling)</label>
                <div className="p-4 bg-gray-900/50 border border-gray-700 rounded-lg">
                  <p className="text-white whitespace-pre-wrap">{product.genericDescription}</p>
                </div>
              </div>
            )}

            {/* Online Store Links */}
            {product.onlineStoreLinks && product.onlineStoreLinks.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Enlaces a Tiendas Online</label>
                <div className="space-y-2">
                  {product.onlineStoreLinks.map((link, index) => (
                    <a
                      key={index}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-3 bg-primary-500/10 border border-primary-500/30 rounded-lg hover:bg-primary-500/20 transition-colors group"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="p-2 bg-primary-500/20 rounded-lg">
                          <svg className="w-5 h-5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                          </svg>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-medium text-white">{link.store || 'Tienda Online'}</span>
                            {link.isPreferred && (
                              <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-300 text-xs rounded-full">
                                Principal
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 truncate max-w-md">{link.url}</p>
                        </div>
                      </div>
                      <svg className="w-5 h-5 text-primary-400 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Image */}
            {product.imageUrl && (
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Imagen</label>
                <div className="relative rounded-lg overflow-hidden border border-gray-700">
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="w-full h-auto object-cover"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.parentElement.innerHTML = '<div class="p-8 text-center text-gray-500">Imagen no disponible</div>';
                    }}
                  />
                </div>
              </div>
            )}

            {/* All Dimensions (Own + Inherited) */}
            {allDimensions.length > 0 && (
              <div className="p-4 bg-purple-500/5 rounded-lg border border-purple-500/20">
                <div className="flex items-center space-x-2 mb-3">
                  <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                  </svg>
                  <span className="text-sm text-purple-300 font-medium">Dimensiones Disponibles</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {allDimensions.map((dim) => {
                    const isOwn = product.enabledDimensions && product.enabledDimensions.includes(dim);
                    const dimInfo = AVAILABLE_DIMENSIONS[dim];
                    const unit = allDimensionUnits[dim] || '';

                    return (
                      <span
                        key={dim}
                        className={`px-3 py-1 rounded-lg text-sm flex items-center space-x-1 ${
                          isOwn
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {dimInfo && <span>{dimInfo.icon}</span>}
                        <span>{dimInfo ? dimInfo.label : dim}</span>
                        {unit && <span className="text-xs opacity-75">({unit})</span>}
                        {!isOwn && <span className="text-xs opacity-75">• heredada</span>}
                      </span>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  {product.enabledDimensions && product.enabledDimensions.length > 0
                    ? 'Las propias están en morado, las heredadas en ámbar'
                    : 'Todas estas dimensiones se heredan de productos padres'}
                </p>
              </div>
            )}

            {/* Attribute Values */}
            {product.attributes && Object.keys(product.attributes).length > 0 && (
              <div className="p-4 bg-blue-500/5 rounded-lg border border-blue-500/20">
                <div className="flex items-center space-x-2 mb-3">
                  <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <span className="text-sm text-blue-300 font-medium">Valores de Dimensiones</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(product.attributes).map(([key, value]) => {
                    const dimInfo = AVAILABLE_DIMENSIONS[key];
                    const unit = allDimensionUnits[key] || '';
                    return (
                      <div key={key} className="p-3 bg-gray-900/50 border border-gray-700 rounded">
                        <label className="block text-xs font-medium text-gray-400 mb-1 flex items-center space-x-1">
                          {dimInfo && <span>{dimInfo.icon}</span>}
                          <span>{dimInfo ? dimInfo.label : key}</span>
                        </label>
                        <p className="text-white font-semibold">{value} {unit}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Children Count */}
            {product.children && product.children.length > 0 && (
              <div className="p-4 bg-blue-500/5 rounded-lg border border-blue-500/20">
                <div className="flex items-center space-x-2">
                  <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span className="text-sm text-blue-300 font-medium">
                    Este producto tiene {product.children.length} hijo{product.children.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProductDetailsModal;
