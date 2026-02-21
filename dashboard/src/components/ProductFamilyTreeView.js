import React, { useState, useEffect } from 'react';
import CatalogUpload from './CatalogUpload';
import { useTranslation } from '../i18n';

const API_URL = process.env.REACT_APP_API_URL || 'https://hanbot-production.up.railway.app';

// Recursive component to render a single product node and its children
function ProductNode({ product, onEdit, onDelete, onAddChild, onCopy, onImport, onDetails, level = 0, expandedNodes, onToggleExpand, parentChain = [] }) {
  const { t } = useTranslation();
  const isExpanded = expandedNodes.has(product._id);
  const hasChildren = product.children && product.children.length > 0;
  const indentPixels = level * 32; // 32px per level (equivalent to ml-8 = 2rem = 32px)

  // Helper function to get inherited dimensions from parent chain
  const getInheritedDimensions = () => {
    const inherited = new Set();

    // Walk through parent chain to collect enabled dimensions
    [...parentChain, product].forEach(p => {
      if (p.enabledDimensions && Array.isArray(p.enabledDimensions)) {
        p.enabledDimensions.forEach(dim => inherited.add(dim));
      }
    });

    return Array.from(inherited);
  };

  // Check if sellable product has missing or zero dimension values
  const hasMissingDimensions = () => {
    if (!product.sellable) return false;

    const inheritedDims = getInheritedDimensions();
    if (inheritedDims.length === 0) return false;

    const attributes = product.attributes || {};

    // Check if any inherited dimension is missing or = 0
    return inheritedDims.some(dimKey => {
      const value = attributes[dimKey];
      return !value || value === '0' || parseFloat(value) === 0;
    });
  };

  return (
    <div className="border-l-2 border-gray-700/50">
      {/* Product Row */}
      <div className="flex items-center justify-between px-6 py-4 hover:bg-gray-700/30 transition-colors" style={{ marginLeft: `${indentPixels}px` }}>
        <div className="flex items-center space-x-4 flex-1">
          {/* Expand/Collapse Button */}
          {hasChildren ? (
            <button
              onClick={() => onToggleExpand(product._id)}
              className="p-1 text-gray-400 hover:text-white transition-colors"
              title={isExpanded ? "Contraer" : "Expandir"}
            >
              <svg className={`w-5 h-5 transform transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <div className="w-7"></div>
          )}

          {/* Product Info */}
          <div className="flex-1">
            <button
              onClick={() => onDetails(product, parentChain)}
              className="flex items-center space-x-3 cursor-pointer hover:opacity-80 transition-opacity text-left"
              title={t('familyTree.viewDetailsTooltip')}
            >
              <h3 className="text-sm font-semibold text-white hover:text-indigo-400 transition-colors">{product.name}</h3>

              {/* Item ID */}
              <span className="text-[10px] text-gray-500 font-mono" title={`ID: ${product._id}`}>
                {product._id?.slice(-6)}
              </span>

              {/* Generation Badge */}
              <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded text-xs font-medium">
                Gen {product.generation || 1}
              </span>

              {/* Sellable Badge */}
              {product.sellable && (
                <span className="px-2 py-0.5 bg-green-500/20 text-green-300 rounded text-xs font-medium flex items-center space-x-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{t('familyTree.sellable')}</span>
                  {product.requiresHumanAdvisor && (
                    <svg className="w-3 h-3 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" title={t('familyTree.requiresAdvisor')}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  )}
                </span>
              )}

              {/* Missing Link Warning */}
              {product.sellable && !product.requiresHumanAdvisor && (!product.onlineStoreLinks || product.onlineStoreLinks.length === 0) && (
                <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-xs font-medium flex items-center space-x-1" title={t('familyTree.noLinkTooltip')}>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  <span>{t('familyTree.noLink')}</span>
                </span>
              )}

              {/* Missing Dimensions Warning */}
              {product.sellable && hasMissingDimensions() && (
                <span className="px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded text-xs font-medium flex items-center space-x-1" title={t('familyTree.noDimensionsTooltip')}>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <span>{t('familyTree.noDimensions')}</span>
                </span>
              )}
            </button>

            {/* Description */}
            {product.description && (
              <p className="text-xs text-gray-400 mt-1">{product.description}</p>
            )}

            {/* Additional Info for Sellable Products */}
            {product.sellable && (
              <div className="flex items-center space-x-4 mt-2 text-xs">
                {product.sku && <span className="text-gray-400">SKU: {product.sku}</span>}
                {product.stock !== undefined && <span className="text-gray-400">{t('familyTree.inventory')} {product.stock}</span>}
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => !product.sellable && onAddChild(product)}
            disabled={product.sellable}
            className={`p-2 rounded-lg transition-colors ${
              product.sellable
                ? 'text-gray-600 cursor-not-allowed opacity-50'
                : 'text-green-400 hover:bg-green-500/20'
            }`}
            title={product.sellable ? t('familyTree.noChildrenSellable') : t('familyTree.addChild')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={() => onCopy(product)}
            className="p-2 text-purple-400 hover:bg-purple-500/20 rounded-lg transition-colors"
            title={t('familyTree.copySibling')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
          <button
            onClick={() => !product.sellable && onImport(product)}
            disabled={product.sellable}
            className={`p-2 rounded-lg transition-colors ${
              product.sellable
                ? 'text-gray-600 cursor-not-allowed opacity-50'
                : 'text-amber-400 hover:bg-amber-500/20'
            }`}
            title={product.sellable ? t('familyTree.noImportSellable') : t('familyTree.importProducts')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
            </svg>
          </button>
          <button
            onClick={() => onDetails(product, parentChain)}
            className="p-2 text-indigo-400 hover:bg-indigo-500/20 rounded-lg transition-colors"
            title={t('familyTree.viewDetails')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button
            onClick={() => onEdit(product)}
            className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors"
            title={t('familyTree.edit')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(product)}
            className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
            title="Eliminar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Children (Recursively render) */}
      {isExpanded && hasChildren && (
        <div className="ml-6 border-l-2 border-gray-700/30">
          {product.children.map((child) => (
            <ProductNode
              key={child._id}
              product={child}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
              onCopy={onCopy}
              onImport={onImport}
              onDetails={onDetails}
              level={level + 1}
              expandedNodes={expandedNodes}
              onToggleExpand={onToggleExpand}
              parentChain={[...parentChain, product]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductFamilyTreeView({
  products,
  loading,
  onAdd,
  onEdit,
  onDelete,
  onAddChild,
  onCopy,
  onImport,
  onDetails,
  editingProduct
}) {
  // Manage expanded nodes state (Set of product IDs)
  // Start with all trees collapsed
  const [expandedNodes, setExpandedNodes] = useState(new Set());

  // Global catalog state
  const [globalCatalog, setGlobalCatalog] = useState(null);

  useEffect(() => {
    const fetchGlobalCatalog = async () => {
      try {
        const response = await fetch(`${API_URL}/uploads/catalog/global`);
        const data = await response.json();
        if (data.success) {
          setGlobalCatalog(data.data.catalog);
        }
      } catch (error) {
        console.error('Error fetching global catalog:', error);
      }
    };
    fetchGlobalCatalog();
  }, []);

  // Helper function to find path from product to root
  const findPathToRoot = (productId, products, path = []) => {
    // Recursively search through the tree
    for (const product of products) {
      if (product._id === productId) {
        return [...path, product._id];
      }
      if (product.children && product.children.length > 0) {
        const found = findPathToRoot(productId, product.children, [...path, product._id]);
        if (found) return found;
      }
    }
    return null;
  };

  // When editing a product, expand the path to that product (collapse all others)
  React.useEffect(() => {
    if (editingProduct && products && products.length > 0) {
      const path = findPathToRoot(editingProduct._id, products);
      if (path) {
        // Only expand nodes in the path to the editing product
        setExpandedNodes(new Set(path));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingProduct, products]);

  // Toggle expand/collapse for a node
  const handleToggleExpand = (productId) => {
    setExpandedNodes(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(productId)) {
        newExpanded.delete(productId);
      } else {
        newExpanded.add(productId);
      }
      return newExpanded;
    });
  };

  // Wrap onAddChild to auto-expand the parent
  const handleAddChild = (product) => {
    // Expand the parent node
    setExpandedNodes(prev => {
      const newExpanded = new Set(prev);
      newExpanded.add(product._id);
      return newExpanded;
    });

    // Call the original onAddChild
    onAddChild(product);
  };

  return (
    <div>
      {/* Header with Add Button */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Familias de Productos</h1>
          <p className="text-gray-400 mt-2">Gestiona árboles de familias de productos con relaciones padre-hijo generacionales</p>
        </div>
        <button
          onClick={onAdd}
          className="px-6 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center space-x-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Nueva Familia de Productos</span>
        </button>
      </div>

      {/* Global Catalog */}
      <div className="bg-gray-800/50 backdrop-blur-lg border border-blue-500/30 rounded-xl p-6 mb-6">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Catálogo Global</h3>
            <p className="text-sm text-gray-400">Se usa cuando no hay catálogo en el anuncio, campaña o familia de producto</p>
          </div>
        </div>
        <CatalogUpload
          entityType="global"
          entityId="global"
          currentCatalog={globalCatalog}
          onUploadSuccess={(catalog) => setGlobalCatalog(catalog)}
          onDeleteSuccess={() => setGlobalCatalog(null)}
        />
      </div>

      {/* Product Family Tree */}
      <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-xl font-bold text-white">Árbol de Familias de Productos</h2>
          <p className="text-sm text-gray-400 mt-1">
            Vista de árbol expandible mostrando generaciones de productos. Solo los productos vendibles pueden ofrecerse en campañas.
          </p>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-gray-400 mt-4">Cargando familias de productos...</p>
          </div>
        ) : !products || products.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-700/50 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No se encontraron familias de productos</h3>
            <p className="text-gray-400 mb-6">Comienza agregando tu primera familia de productos</p>
            <button
              onClick={onAdd}
              className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors inline-flex items-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Agregar Familia de Productos</span>
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {products.map((product) => (
              <ProductNode
                key={product._id}
                product={product}
                onEdit={onEdit}
                onDelete={onDelete}
                onAddChild={handleAddChild}
                onCopy={onCopy}
                onImport={onImport}
                onDetails={onDetails}
                level={0}
                expandedNodes={expandedNodes}
                onToggleExpand={handleToggleExpand}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ProductFamilyTreeView;
