import React, { useState } from 'react';

// Helper function to collect all descendant IDs recursively
function collectAllDescendantIds(product) {
  let ids = [product._id];

  if (product.children && product.children.length > 0) {
    product.children.forEach(child => {
      ids = ids.concat(collectAllDescendantIds(child));
    });
  }

  return ids;
}

function ProductTreeNode({ product, selectedProducts, inheritedProducts = [], onToggle, level = 0, readOnly = false }) {
  const [isExpanded, setIsExpanded] = useState(false); // Start collapsed
  const hasChildren = product.children && product.children.length > 0;
  const isSelected = selectedProducts.includes(product._id);
  const isInherited = inheritedProducts.includes(product._id);

  // Check if all children are selected (for indeterminate state)
  const allChildIds = hasChildren ? collectAllDescendantIds(product).slice(1) : []; // Exclude parent
  const selectedChildCount = allChildIds.filter(id => selectedProducts.includes(id)).length;
  const inheritedChildCount = allChildIds.filter(id => inheritedProducts.includes(id)).length;
  const isIndeterminate = hasChildren && selectedChildCount > 0 && selectedChildCount < allChildIds.length;
  const isInheritedIndeterminate = hasChildren && inheritedChildCount > 0 && inheritedChildCount < allChildIds.length;

  const handleToggle = (e) => {
    e.stopPropagation();
    if (readOnly) return;

    // Collect this product and all its descendants
    const allIds = collectAllDescendantIds(product);

    onToggle(allIds, isSelected);
  };

  const toggleExpand = (e) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  // Determine visual state
  const showAsSelected = isSelected || (isInherited && selectedProducts.length === 0);
  const showAsInherited = isInherited && selectedProducts.length === 0;

  return (
    <div className="select-none">
      {/* Node Row */}
      <div
        className={`flex items-center py-2 px-3 rounded-lg transition-colors ${
          readOnly ? 'cursor-default' : 'cursor-pointer hover:bg-gray-700/30'
        } ${
          isSelected ? 'bg-primary-500/10' : showAsInherited ? 'bg-amber-500/5' : ''
        }`}
        style={{ paddingLeft: `${level * 1.5 + 0.75}rem` }}
        onClick={handleToggle}
      >
        {/* Expand/Collapse Button */}
        {hasChildren ? (
          <button
            type="button"
            onClick={toggleExpand}
            className="mr-2 p-0.5 hover:bg-gray-600/50 rounded transition-colors"
          >
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${
                isExpanded ? 'rotate-90' : ''
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          <span className="w-5 mr-2"></span>
        )}

        {/* Checkbox */}
        <input
          type="checkbox"
          checked={showAsSelected}
          disabled={readOnly}
          ref={(input) => {
            if (input) {
              input.indeterminate = isIndeterminate || (showAsInherited && isInheritedIndeterminate);
            }
          }}
          onChange={handleToggle}
          onClick={(e) => e.stopPropagation()}
          className={`w-4 h-4 bg-gray-900/50 border-gray-700 rounded focus:ring-primary-500 mr-3 ${
            showAsInherited ? 'text-amber-500' : 'text-primary-500'
          } ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
        />

        {/* Product Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <span className={`text-sm ${
              isSelected ? 'text-primary-300 font-medium' :
              showAsInherited ? 'text-amber-300/80' : 'text-white'
            }`}>
              {product.name}
            </span>
            {showAsInherited && (
              <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded text-xs">
                Heredado
              </span>
            )}
            {product.sellable && (
              <span className="px-1.5 py-0.5 bg-green-500/20 text-green-300 rounded text-xs">
                Vendible
              </span>
            )}
            {!product.available && (
              <span className="px-1.5 py-0.5 bg-red-500/20 text-red-300 rounded text-xs">
                No disponible
              </span>
            )}
          </div>
          {product.price && (
            <div className="text-xs text-gray-400 mt-0.5">${product.price}</div>
          )}
        </div>

        {/* Children count */}
        {hasChildren && (
          <span className="text-xs text-gray-500 ml-2">
            ({product.children.length})
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {product.children.map((child) => (
            <ProductTreeNode
              key={child._id}
              product={child}
              selectedProducts={selectedProducts}
              inheritedProducts={inheritedProducts}
              onToggle={onToggle}
              level={level + 1}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductTreeSelector({ selectedProducts, inheritedProducts = [], inheritedFrom = null, onToggle, products, loading }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandAll, setExpandAll] = useState(false);

  // Filter products based on search term
  const filterProducts = (products, term) => {
    if (!term) return products;

    return products.reduce((acc, product) => {
      const matchesSearch = product.name.toLowerCase().includes(term.toLowerCase());
      const filteredChildren = product.children ? filterProducts(product.children, term) : [];

      if (matchesSearch || filteredChildren.length > 0) {
        acc.push({
          ...product,
          children: filteredChildren
        });
      }

      return acc;
    }, []);
  };

  const filteredProducts = filterProducts(products, searchTerm);

  const handleExpandAll = () => {
    setExpandAll(!expandAll);
  };

  return (
    <div className="space-y-3">
      {/* Search and Controls */}
      <div className="flex space-x-2">
        <div className="flex-1 relative">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar productos..."
            className="w-full pl-9 pr-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <svg
            className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <button
          onClick={handleExpandAll}
          className="px-3 py-2 bg-gray-700/50 text-gray-300 rounded-lg hover:bg-gray-600/50 transition-colors text-sm whitespace-nowrap"
        >
          {expandAll ? 'Contraer todo' : 'Expandir todo'}
        </button>
      </div>

      {/* Tree View */}
      <div className="max-h-96 overflow-y-auto bg-gray-900/30 rounded-lg p-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <svg className="animate-spin h-8 w-8 text-primary-500 mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Cargando productos...</span>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            {searchTerm ? 'No se encontraron productos' : 'No hay productos disponibles'}
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredProducts.map((product) => (
              <ProductTreeNode
                key={product._id}
                product={product}
                selectedProducts={selectedProducts}
                inheritedProducts={inheritedProducts}
                onToggle={onToggle}
                level={0}
              />
            ))}
          </div>
        )}
      </div>

      {/* Selection Summary */}
      <div className="text-sm space-y-1">
        {selectedProducts.length > 0 ? (
          <div className="text-primary-400">
            {selectedProducts.length} producto{selectedProducts.length !== 1 ? 's' : ''} seleccionado{selectedProducts.length !== 1 ? 's' : ''} (específico{selectedProducts.length !== 1 ? 's' : ''})
          </div>
        ) : inheritedProducts.length > 0 ? (
          <div className="text-amber-400">
            {inheritedProducts.length} producto{inheritedProducts.length !== 1 ? 's' : ''} heredado{inheritedProducts.length !== 1 ? 's' : ''}
            {inheritedFrom && <span className="text-gray-500"> de {inheritedFrom}</span>}
          </div>
        ) : (
          <div className="text-gray-500">
            Sin productos seleccionados
          </div>
        )}
        {selectedProducts.length > 0 && inheritedProducts.length > 0 && (
          <div className="text-xs text-gray-500">
            (Sobrescribiendo {inheritedProducts.length} producto{inheritedProducts.length !== 1 ? 's' : ''} heredado{inheritedProducts.length !== 1 ? 's' : ''} de {inheritedFrom})
          </div>
        )}
      </div>
    </div>
  );
}

export default ProductTreeSelector;
