import React, { useState } from 'react';

function ProductTreeNode({ product, selectedProducts, onToggle, level = 0 }) {
  const [isExpanded, setIsExpanded] = useState(level < 2); // Auto-expand first 2 levels
  const hasChildren = product.children && product.children.length > 0;
  const isSelected = selectedProducts.includes(product._id);

  const handleToggle = (e) => {
    e.stopPropagation();
    onToggle(product._id);
  };

  const toggleExpand = (e) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <div className="select-none">
      {/* Node Row */}
      <div
        className={`flex items-center py-2 px-3 rounded-lg hover:bg-gray-700/30 transition-colors cursor-pointer ${
          isSelected ? 'bg-primary-500/10' : ''
        }`}
        style={{ paddingLeft: `${level * 1.5 + 0.75}rem` }}
        onClick={handleToggle}
      >
        {/* Expand/Collapse Button */}
        {hasChildren ? (
          <button
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
          checked={isSelected}
          onChange={handleToggle}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 text-primary-500 bg-gray-900/50 border-gray-700 rounded focus:ring-primary-500 mr-3"
        />

        {/* Product Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <span className={`text-sm ${isSelected ? 'text-primary-300 font-medium' : 'text-white'}`}>
              {product.name}
            </span>
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
              onToggle={onToggle}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductTreeSelector({ selectedProducts, onToggle, products, loading }) {
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
          <div className="text-center py-8 text-gray-400">
            Cargando productos...
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
                onToggle={onToggle}
                level={0}
              />
            ))}
          </div>
        )}
      </div>

      {/* Selection Summary */}
      {selectedProducts.length > 0 && (
        <div className="text-sm text-gray-400">
          {selectedProducts.length} producto{selectedProducts.length !== 1 ? 's' : ''} seleccionado{selectedProducts.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

export default ProductTreeSelector;
