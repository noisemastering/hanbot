import React, { useState, useEffect } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function MLImporterView() {
  const [mlItems, setMlItems] = useState([]);
  const [sellableProducts, setSellableProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingML, setLoadingML] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMLItem, setSelectedMLItem] = useState(null);
  const [productSearch, setProductSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('unlinked'); // 'all', 'unlinked', 'linked', 'inactive'
  const [itemStatuses, setItemStatuses] = useState({}); // ML item statuses (inactive, etc.)

  // Fetch sellable products from Inventario
  const fetchProducts = async () => {
    try {
      const res = await fetch(`${API_URL}/product-families/tree`);
      const data = await res.json();
      if (data.success) {
        // Flatten to get sellable products
        const sellable = flattenSellableProducts(data.data);
        setSellableProducts(sellable);
      }
    } catch (error) {
      console.error('Error fetching products:', error);
    }
  };

  // Fetch ML items
  const fetchMLItems = async () => {
    setLoadingML(true);
    try {
      const token = localStorage.getItem('token');
      console.log('Fetching ML items from:', `${API_URL}/ml/items`);
      const res = await fetch(`${API_URL}/ml/items`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      console.log('ML items response:', data);
      if (data.success) {
        setMlItems(data.items || []);
      } else {
        console.error('Error fetching ML items:', data.error);
        alert('Error cargando ML: ' + data.error);
      }
    } catch (error) {
      console.error('Error fetching ML items:', error);
      alert('Error de conexión: ' + error.message);
    } finally {
      setLoadingML(false);
    }
  };

  // Fetch ML item statuses (inactive, etc.)
  const fetchItemStatuses = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/ml/items/status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setItemStatuses(data.statuses || {});
      }
    } catch (error) {
      console.error('Error fetching item statuses:', error);
    }
  };

  // Toggle inactive status for an ML item
  const toggleInactive = async (item, inactive) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/ml/items/${item.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          inactive,
          inactiveReason: inactive ? 'discontinued' : null,
          lastMLTitle: item.title,
          lastMLPrice: item.price
        })
      });
      const data = await res.json();
      if (data.success) {
        setItemStatuses(prev => ({
          ...prev,
          [item.id]: data.status
        }));
      }
    } catch (error) {
      console.error('Error updating item status:', error);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await fetchProducts();
      await fetchMLItems();
      await fetchItemStatuses();
      setLoading(false);
    };
    init();
  }, []);

  // Flatten product tree to get sellable products
  function flattenSellableProducts(products, parentChain = []) {
    let result = [];
    for (const product of products) {
      if (product.sellable) {
        const path = parentChain.map(p => p.name).join(' > ');
        const mlLink = product.onlineStoreLinks?.find(l =>
          l.url?.includes('mercadolibre') && /MLM-\d{6,}/.test(l.url)
        )?.url;
        result.push({
          ...product,
          path,
          mlLink,
          fullName: path ? `${path} > ${product.name}` : product.name
        });
      }
      if (product.children && product.children.length > 0) {
        result = result.concat(flattenSellableProducts(product.children, [...parentChain, product]));
      }
    }
    return result;
  }

  // Check if ML item is already linked to a product
  const getLinkedProduct = (mlItem) => {
    return sellableProducts.find(p =>
      p.onlineStoreLinks?.some(l => l.url === mlItem.permalink)
    );
  };

  // Link ML item to product
  const linkToProduct = async (mlItem, product) => {
    setSaving(true);
    try {
      const token = localStorage.getItem('token');

      // Get existing links and add new one
      const existingLinks = product.onlineStoreLinks || [];
      const newLinks = [
        ...existingLinks.filter(l => l.url !== mlItem.permalink),
        {
          url: mlItem.permalink,
          store: 'Mercado Libre',
          isPreferred: existingLinks.length === 0
        }
      ];

      const res = await fetch(`${API_URL}/product-families/${product._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          onlineStoreLinks: newLinks,
          price: mlItem.price // Also update price
        })
      });

      const data = await res.json();
      if (data.success) {
        // Refresh products to show updated links
        await fetchProducts();
        setSelectedMLItem(null);
        setProductSearch('');
      } else {
        alert('Error al vincular: ' + data.error);
      }
    } catch (error) {
      console.error('Error linking product:', error);
      alert('Error al vincular producto');
    } finally {
      setSaving(false);
    }
  };

  // Unlink ML item from product
  const unlinkFromProduct = async (mlItem, product) => {
    if (!window.confirm('¿Desvincular este producto de ML?')) return;

    setSaving(true);
    try {
      const token = localStorage.getItem('token');

      const newLinks = (product.onlineStoreLinks || []).filter(l => l.url !== mlItem.permalink);

      const res = await fetch(`${API_URL}/product-families/${product._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ onlineStoreLinks: newLinks })
      });

      const data = await res.json();
      if (data.success) {
        await fetchProducts();
      } else {
        alert('Error al desvincular: ' + data.error);
      }
    } catch (error) {
      console.error('Error unlinking product:', error);
      alert('Error al desvincular producto');
    } finally {
      setSaving(false);
    }
  };

  // Check if item is inactive (manually marked OR ML status is paused/closed)
  const isItemInactive = (item) => itemStatuses[item.id]?.inactive === true;
  const isItemPaused = (item) => item.status === 'paused' || item.status === 'closed';
  const isItemUnavailable = (item) => isItemInactive(item) || isItemPaused(item);

  // Filter ML items
  const filteredMLItems = mlItems.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(searchTerm.toLowerCase());
    const linkedProduct = getLinkedProduct(item);
    const unavailable = isItemUnavailable(item);

    // Hide unavailable unless filter is 'all' or 'inactive'
    if (unavailable && filter !== 'all' && filter !== 'inactive') return false;

    if (filter === 'linked') return matchesSearch && linkedProduct;
    if (filter === 'unlinked') return matchesSearch && !linkedProduct && !unavailable;
    if (filter === 'inactive') return matchesSearch && unavailable;
    return matchesSearch;
  });

  // Filter products for linking modal
  const filteredProducts = sellableProducts.filter(p =>
    p.fullName.toLowerCase().includes(productSearch.toLowerCase()) ||
    p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  const linkedCount = mlItems.filter(item => getLinkedProduct(item) && !isItemUnavailable(item)).length;
  const pausedCount = mlItems.filter(item => isItemPaused(item)).length;
  const manualInactiveCount = mlItems.filter(item => isItemInactive(item) && !isItemPaused(item)).length;
  const inactiveCount = pausedCount + manualInactiveCount;
  const unlinkedCount = mlItems.filter(item => !getLinkedProduct(item) && !isItemUnavailable(item)).length;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Importador ML</h1>
        <p className="text-gray-400 text-sm mt-1">
          Vincula productos de Mercado Libre con tu inventario
        </p>
      </div>

      {/* Stats & Controls */}
      <div className="mb-4 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Total ML:</span>
          <span className="text-white font-medium">{mlItems.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-green-400">Vinculados:</span>
          <span className="text-white font-medium">{linkedCount}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-amber-400">Sin vincular:</span>
          <span className="text-white font-medium">{unlinkedCount}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-red-400">No disponible:</span>
          <span className="text-white font-medium">{pausedCount}</span>
        </div>
        {manualInactiveCount > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Inactivos:</span>
            <span className="text-white font-medium">{manualInactiveCount}</span>
          </div>
        )}

        <div className="flex-1" />

        {/* Refresh button */}
        <button
          onClick={fetchMLItems}
          disabled={loadingML}
          className="px-4 py-2 bg-primary-500/20 text-primary-300 rounded-lg hover:bg-primary-500/30 transition-colors text-sm font-medium disabled:opacity-50"
        >
          {loadingML ? 'Cargando...' : 'Actualizar ML'}
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-4 items-center">
        <div className="flex-1 min-w-64">
          <input
            type="text"
            placeholder="Buscar en ML..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary-500"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'all'
                ? 'bg-gray-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Todos
          </button>
          <button
            onClick={() => setFilter('unlinked')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'unlinked'
                ? 'bg-amber-500/30 text-amber-300'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Sin vincular
          </button>
          <button
            onClick={() => setFilter('linked')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'linked'
                ? 'bg-green-500/30 text-green-300'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Vinculados
          </button>
          <button
            onClick={() => setFilter('inactive')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'inactive'
                ? 'bg-gray-500/30 text-gray-300'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Inactivos
          </button>
        </div>
      </div>

      {/* ML Items List */}
      {loading || loadingML ? (
        <div className="text-center py-12">
          <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-400 mt-4">
            {loadingML ? 'Cargando productos de Mercado Libre... (esto puede tardar unos segundos)' : 'Cargando inventario...'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredMLItems.length === 0 ? (
            <div className="text-center py-12 bg-gray-800/30 rounded-lg">
              <p className="text-gray-400">No se encontraron productos</p>
            </div>
          ) : (
            filteredMLItems.map((item) => {
              const linkedProduct = getLinkedProduct(item);
              const paused = isItemPaused(item);
              const manualInactive = isItemInactive(item);
              const unavailable = paused || manualInactive;

              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-4 p-4 rounded-lg border transition-colors ${
                    unavailable
                      ? 'bg-gray-900/50 border-gray-800 opacity-60'
                      : linkedProduct
                        ? 'bg-green-500/5 border-green-500/30'
                        : 'bg-gray-800/50 border-gray-700/50 hover:border-gray-600'
                  }`}
                >
                  {/* Thumbnail */}
                  {item.thumbnail && (
                    <img
                      src={item.thumbnail}
                      alt={item.title}
                      className={`w-16 h-16 object-cover rounded-lg bg-gray-700 ${unavailable ? 'grayscale' : ''}`}
                    />
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className={`font-medium truncate ${unavailable ? 'text-gray-500' : 'text-white'}`}>{item.title}</h3>
                      {paused && (
                        <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs font-medium rounded">
                          No disponible
                        </span>
                      )}
                      {manualInactive && !paused && (
                        <span className="px-2 py-0.5 bg-gray-700 text-gray-400 text-xs font-medium rounded">
                          Inactivo
                        </span>
                      )}
                      {linkedProduct && !unavailable && (
                        <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs font-medium rounded">
                          Vinculado
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1">
                      <span className={`font-semibold ${unavailable ? 'text-gray-500' : 'text-yellow-400'}`}>
                        ${item.price?.toLocaleString()}
                      </span>
                      {item.original_price && item.original_price !== item.price && (
                        <span className="text-xs text-gray-500 line-through">
                          ${item.original_price?.toLocaleString()}
                        </span>
                      )}
                      <a
                        href={`https://articulo.mercadolibre.com.mx/${item.id.replace(/^(MLM)(\d+)$/, '$1-$2')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        Ver en ML →
                      </a>
                    </div>
                    {linkedProduct && !unavailable && (
                      <div className="mt-2 text-sm text-green-400">
                        ✓ Vinculado a: <span className="text-white">{linkedProduct.fullName}</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {paused ? (
                      <span className="text-xs text-gray-500 italic">Pausado en ML</span>
                    ) : manualInactive ? (
                      <button
                        onClick={() => toggleInactive(item, false)}
                        className="px-3 py-1.5 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 transition-colors text-sm"
                      >
                        Reactivar
                      </button>
                    ) : linkedProduct ? (
                      <>
                        <button
                          onClick={() => unlinkFromProduct(item, linkedProduct)}
                          disabled={saving}
                          className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors text-sm"
                        >
                          Desvincular
                        </button>
                        <button
                          onClick={() => toggleInactive(item, true)}
                          className="px-3 py-1.5 bg-gray-700 text-gray-400 rounded hover:bg-gray-600 transition-colors text-sm"
                          title="Marcar como inactivo"
                        >
                          Inactivar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setSelectedMLItem(item)}
                          className="px-3 py-1.5 bg-primary-500 text-white rounded hover:bg-primary-600 transition-colors text-sm font-medium"
                        >
                          Vincular
                        </button>
                        <button
                          onClick={() => toggleInactive(item, true)}
                          className="px-3 py-1.5 bg-gray-700 text-gray-400 rounded hover:bg-gray-600 transition-colors text-sm"
                          title="Marcar como inactivo"
                        >
                          Inactivar
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Link Modal */}
      {selectedMLItem && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            {/* Modal Header */}
            <div className="p-4 border-b border-gray-700">
              <h2 className="text-lg font-semibold text-white">Vincular producto ML</h2>
              <p className="text-sm text-gray-400 mt-1 truncate">{selectedMLItem.title}</p>
              <p className="text-yellow-400 font-medium">${selectedMLItem.price?.toLocaleString()}</p>
            </div>

            {/* Search */}
            <div className="p-4 border-b border-gray-700">
              <input
                type="text"
                placeholder="Buscar producto en inventario..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                autoFocus
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary-500"
              />
            </div>

            {/* Products List */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-2">
                {filteredProducts.slice(0, 50).map((product) => (
                  <button
                    key={product._id}
                    onClick={() => linkToProduct(selectedMLItem, product)}
                    disabled={saving}
                    className="w-full flex items-center justify-between p-3 bg-gray-900/50 hover:bg-gray-700/50 rounded-lg transition-colors text-left disabled:opacity-50"
                  >
                    <div>
                      <p className="text-white">{product.name}</p>
                      <p className="text-xs text-gray-500">{product.path}</p>
                      {product.mlLink && (
                        <p className="text-xs text-amber-400 mt-1">⚠ Ya tiene link ML</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-gray-400">${product.price?.toLocaleString() || '-'}</p>
                    </div>
                  </button>
                ))}
                {filteredProducts.length > 50 && (
                  <p className="text-center text-gray-500 text-sm py-2">
                    Mostrando 50 de {filteredProducts.length} resultados
                  </p>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-700">
              <button
                onClick={() => { setSelectedMLItem(null); setProductSearch(''); }}
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

export default MLImporterView;
