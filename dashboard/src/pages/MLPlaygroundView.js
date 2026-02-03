// pages/MLPlaygroundView.js
import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function MLPlaygroundView() {
  const [status, setStatus] = useState(null);
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [itemDetails, setItemDetails] = useState(null);
  const [newPrice, setNewPrice] = useState('');
  const [loading, setLoading] = useState({ status: false, items: false, details: false, update: false });
  const [itemSearch, setItemSearch] = useState('');
  const [apiLog, setApiLog] = useState([]);

  const addLog = (type, message, data = null) => {
    const entry = {
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
      type,
      message,
      data
    };
    setApiLog(prev => [entry, ...prev].slice(0, 50));
  };

  const fetchStatus = async () => {
    setLoading(prev => ({ ...prev, status: true }));
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/ml/playground/status`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setStatus(data);
      addLog(data.connected ? 'success' : 'warning', 'Connection status checked', data);
    } catch (error) {
      addLog('error', 'Failed to check status', error.message);
      toast.error('Error checking ML status');
    } finally {
      setLoading(prev => ({ ...prev, status: false }));
    }
  };

  const fetchItems = async () => {
    setLoading(prev => ({ ...prev, items: true }));
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/ml/playground/items?limit=30`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setItems(data.items);
        addLog('success', `Fetched ${data.items.length} items`, { total: data.total });
      } else {
        addLog('error', 'Failed to fetch items', data.error);
      }
    } catch (error) {
      addLog('error', 'Failed to fetch items', error.message);
      toast.error('Error fetching items');
    } finally {
      setLoading(prev => ({ ...prev, items: false }));
    }
  };

  const fetchItemDetails = async (itemId) => {
    setLoading(prev => ({ ...prev, details: true }));
    setSelectedItem(itemId);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/ml/playground/item/${itemId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setItemDetails(data);
        setNewPrice(data.item.price?.toString() || '');
        addLog('success', `Fetched details for ${itemId}`, data.item);
      } else {
        addLog('error', `Failed to fetch ${itemId}`, data.error);
        toast.error(data.error);
      }
    } catch (error) {
      addLog('error', `Failed to fetch ${itemId}`, error.message);
      toast.error('Error fetching item details');
    } finally {
      setLoading(prev => ({ ...prev, details: false }));
    }
  };

  const updatePrice = async () => {
    if (!selectedItem || !newPrice) return;

    const price = parseFloat(newPrice);
    if (isNaN(price) || price <= 0) {
      toast.error('Precio invalido');
      return;
    }

    setLoading(prev => ({ ...prev, update: true }));
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/ml/playground/item/${selectedItem}/price`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ price })
      });
      const data = await res.json();

      if (data.success) {
        toast.success(`Precio actualizado a $${price}`);
        addLog('success', `Price updated for ${selectedItem}`, { newPrice: price, response: data });
        // Refresh item details
        fetchItemDetails(selectedItem);
        // Refresh items list
        fetchItems();
      } else {
        addLog('error', `Failed to update price for ${selectedItem}`, data);
        toast.error(data.error || 'Error updating price');
      }
    } catch (error) {
      addLog('error', `Failed to update price`, error.message);
      toast.error('Error updating price');
    } finally {
      setLoading(prev => ({ ...prev, update: false }));
    }
  };

  useEffect(() => {
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredItems = items.filter(item =>
    item.title?.toLowerCase().includes(itemSearch.toLowerCase()) ||
    item.id?.toLowerCase().includes(itemSearch.toLowerCase()) ||
    item.sku?.toLowerCase().includes(itemSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">ML API Playground</h2>
          <p className="text-sm text-gray-400 mt-1">Prueba integraciones con Mercado Libre</p>
        </div>
      </div>

      {/* Connection Status */}
      <div className="bg-gray-800/50 rounded-lg border border-gray-700/50 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className={`w-3 h-3 rounded-full ${status?.connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <div>
              <h3 className="text-white font-medium">Estado de Conexion</h3>
              <p className="text-sm text-gray-400">
                {status?.connected
                  ? `Conectado como ${status.sellerNickname} (${status.sellerId})`
                  : status?.message || 'No conectado'}
              </p>
            </div>
          </div>
          <button
            onClick={fetchStatus}
            disabled={loading.status}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {loading.status ? 'Verificando...' : 'Verificar'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Items List */}
        <div className="bg-gray-800/50 rounded-lg border border-gray-700/50 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Items en ML</h3>
            <button
              onClick={fetchItems}
              disabled={loading.items || !status?.connected}
              className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              {loading.items ? 'Cargando...' : 'Cargar Items'}
            </button>
          </div>

          {items.length > 0 && (
            <input
              type="text"
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              placeholder="Buscar por titulo, ID o SKU..."
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-400 mb-3"
            />
          )}

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {filteredItems.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">
                {items.length === 0 ? 'Haz clic en "Cargar Items" para ver tus publicaciones' : 'No se encontraron items'}
              </p>
            ) : (
              filteredItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => fetchItemDetails(item.id)}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedItem === item.id
                      ? 'bg-primary-600/20 border-primary-500'
                      : 'bg-gray-700/30 border-gray-600/50 hover:border-gray-500'
                  }`}
                >
                  <div className="flex items-start space-x-3">
                    {item.thumbnail && (
                      <img src={item.thumbnail} alt="" className="w-12 h-12 rounded object-cover" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{item.title}</p>
                      <div className="flex items-center space-x-2 mt-1">
                        <span className="text-xs text-gray-400">{item.id}</span>
                        {item.sku && <span className="text-xs text-blue-400">SKU: {item.sku}</span>}
                      </div>
                      <div className="flex items-center space-x-2 mt-1">
                        <span className="text-sm font-medium text-green-400">${item.price}</span>
                        {item.original_price && item.original_price !== item.price && (
                          <span className="text-xs text-gray-500 line-through">${item.original_price}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Item Details & Price Update */}
        <div className="bg-gray-800/50 rounded-lg border border-gray-700/50 p-4">
          <h3 className="text-lg font-semibold text-white mb-4">Detalles del Item</h3>

          {loading.details ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500"></div>
            </div>
          ) : itemDetails ? (
            <div className="space-y-4">
              <div className="flex items-start space-x-4">
                {itemDetails.item.thumbnail && (
                  <img src={itemDetails.item.thumbnail} alt="" className="w-20 h-20 rounded-lg object-cover" />
                )}
                <div>
                  <h4 className="text-white font-medium">{itemDetails.item.title}</h4>
                  <p className="text-sm text-gray-400">{itemDetails.item.id}</p>
                  <a
                    href={itemDetails.item.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary-400 hover:underline"
                  >
                    Ver en ML
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-gray-700/50 rounded p-2">
                  <span className="text-gray-400">Precio actual:</span>
                  <span className="text-green-400 font-medium ml-2">${itemDetails.item.price}</span>
                </div>
                {itemDetails.item.original_price && (
                  <div className="bg-gray-700/50 rounded p-2">
                    <span className="text-gray-400">Precio original:</span>
                    <span className="text-gray-300 ml-2">${itemDetails.item.original_price}</span>
                  </div>
                )}
                <div className="bg-gray-700/50 rounded p-2">
                  <span className="text-gray-400">Estado:</span>
                  <span className={`ml-2 ${itemDetails.item.status === 'active' ? 'text-green-400' : 'text-yellow-400'}`}>
                    {itemDetails.item.status}
                  </span>
                </div>
                <div className="bg-gray-700/50 rounded p-2">
                  <span className="text-gray-400">Disponibles:</span>
                  <span className="text-white ml-2">{itemDetails.item.available_quantity}</span>
                </div>
                <div className="bg-gray-700/50 rounded p-2">
                  <span className="text-gray-400">Vendidos:</span>
                  <span className="text-white ml-2">{itemDetails.item.sold_quantity}</span>
                </div>
                {itemDetails.item.seller_custom_field && (
                  <div className="bg-gray-700/50 rounded p-2">
                    <span className="text-gray-400">SKU:</span>
                    <span className="text-blue-400 ml-2">{itemDetails.item.seller_custom_field}</span>
                  </div>
                )}
              </div>

              {/* Price Update Form */}
              <div className="border-t border-gray-700 pt-4 mt-4">
                <h4 className="text-white font-medium mb-3">Actualizar Precio</h4>
                <div className="flex space-x-3">
                  <div className="flex-1">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input
                        type="number"
                        value={newPrice}
                        onChange={(e) => setNewPrice(e.target.value)}
                        className="w-full pl-8 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500"
                        placeholder="Nuevo precio"
                        min="1"
                        step="0.01"
                      />
                    </div>
                  </div>
                  <button
                    onClick={updatePrice}
                    disabled={loading.update || !newPrice}
                    className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading.update ? 'Actualizando...' : 'Actualizar'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Nota: Si el item tiene promocion activa, el precio puede no actualizarse.
                </p>
              </div>
            </div>
          ) : (
            <p className="text-gray-400 text-center py-12">
              Selecciona un item para ver sus detalles
            </p>
          )}
        </div>
      </div>

      {/* API Log */}
      <div className="bg-gray-800/50 rounded-lg border border-gray-700/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-white">API Log</h3>
          <button
            onClick={() => setApiLog([])}
            className="text-sm text-gray-400 hover:text-white"
          >
            Limpiar
          </button>
        </div>
        <div className="space-y-2 max-h-48 overflow-y-auto font-mono text-xs">
          {apiLog.length === 0 ? (
            <p className="text-gray-500">No hay actividad registrada</p>
          ) : (
            apiLog.map((entry) => (
              <div
                key={entry.id}
                className={`p-2 rounded ${
                  entry.type === 'success' ? 'bg-green-500/10 text-green-400' :
                  entry.type === 'error' ? 'bg-red-500/10 text-red-400' :
                  'bg-yellow-500/10 text-yellow-400'
                }`}
              >
                <span className="text-gray-500">[{entry.time}]</span> {entry.message}
                {entry.data && (
                  <pre className="mt-1 text-gray-400 overflow-x-auto">
                    {JSON.stringify(entry.data, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default MLPlaygroundView;
