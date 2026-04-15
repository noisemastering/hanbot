import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import AdModal from './AdModal';
import API from '../api';
import { useTranslation } from '../i18n';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const STATUS_STYLE = {
  ACTIVE: "bg-green-500/10 border-green-500/30 text-green-300 hover:bg-green-500/20",
  PAUSED: "bg-yellow-500/10 border-yellow-500/30 text-yellow-300 hover:bg-yellow-500/20",
  ARCHIVED: "bg-gray-500/10 border-gray-500/30 text-gray-400 hover:bg-gray-500/20"
};

const CONVO_FLOW_NAMES = {
  convo_bordeSeparadorRetail: "Borde Separador (Menudeo)",
  convo_bordeSeparadorWholesale: "Borde Separador (Mayoreo)",
  convo_confeccionadaRetail: "Confeccionada (Menudeo)",
  convo_groundcoverWholesale: "Ground Cover (Mayoreo)",
  convo_rolloRaschelWholesale: "Rollo Raschel (Mayoreo)",
  convo_vende_malla: "Vende Malla (Distribuidor)"
};


function AdsView() {
  const { t, locale } = useTranslation();
  const [ads, setAds] = useState([]);
  const [adSets, setAdSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAd, setSelectedAd] = useState(null);
  const [showAdModal, setShowAdModal] = useState(false);
  const [editingAd, setEditingAd] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [directLinkInput, setDirectLinkInput] = useState('');
  const [settingDirectLink, setSettingDirectLink] = useState(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchAds();
    fetchAdSets();
  }, []);

  const fetchAds = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/ads`);
      const data = await res.json();
      if (data.success) {
        setAds(data.data || []);
      }
    } catch (error) {
      console.error("Error fetching ads:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAdSets = async () => {
    try {
      const res = await fetch(`${API_URL}/adsets`);
      const data = await res.json();
      if (data.success) {
        setAdSets(data.data || []);
      }
    } catch (error) {
      console.error("Error fetching ad sets:", error);
    }
  };

  const syncFromFacebook = async () => {
    setSyncing(true);
    try {
      const res = await API.post('/campaigns/sync-facebook');
      const r = res.data.results;
      toast.success(`Sync: ${r.campaigns?.created || 0} campañas, ${r.adSets?.created || 0} ad sets, ${r.ads?.created || 0} anuncios nuevos`);
      fetchAds();
      fetchAdSets();
    } catch (err) {
      toast.error('Error: ' + (err.response?.data?.error || err.message));
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveAd = async (adData) => {
    try {
      const url = editingAd
        ? `${API_URL}/ads/${editingAd._id}`
        : `${API_URL}/ads`;
      const method = editingAd ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adData)
      });

      const data = await res.json();

      if (data.success) {
        if (editingAd) {
          // Update locally — re-fetch to get populated fields
          const freshRes = await fetch(`${API_URL}/ads/${editingAd._id}`);
          const freshData = await freshRes.json();
          if (freshData.success) {
            setAds(prev => prev.map(a => a._id === editingAd._id ? freshData.data : a));
          }
        } else {
          // New ad — fetch it with populated fields
          const freshRes = await fetch(`${API_URL}/ads/${data.data._id}`);
          const freshData = await freshRes.json();
          if (freshData.success) {
            setAds(prev => [freshData.data, ...prev]);
          }
        }
        setShowAdModal(false);
        setEditingAd(null);
        toast.success(editingAd ? t('ads.updatedSuccess') : t('ads.createdSuccess'));
      } else {
        toast.error(t('ads.errorSaveDetail') + (data.error || t('ads.errorUnknown')));
      }
    } catch (error) {
      console.error("Error saving ad:", error);
      toast.error(t('ads.errorSave'));
    }
  };

  const handleDeleteAd = async (ad) => {
    if (!window.confirm(`¿Eliminar el anuncio "${ad.name}"?`)) return;
    try {
      const res = await fetch(`${API_URL}/ads/${ad._id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setAds(prev => prev.filter(a => a._id !== ad._id));
        setSelectedIds(prev => { const next = new Set(prev); next.delete(ad._id); return next; });
        toast.success('Anuncio eliminado');
      } else {
        toast.error('Error: ' + (data.error || 'desconocido'));
      }
    } catch (error) {
      console.error("Error deleting ad:", error);
      toast.error('Error al eliminar el anuncio');
    }
  };

  const handleStatusChange = async (adId, newStatus) => {
    try {
      const res = await fetch(`${API_URL}/ads/${adId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });

      const data = await res.json();
      if (data.success) {
        setAds(prev => prev.map(a => a._id === adId ? { ...a, status: newStatus } : a));
        toast.success(t('ads.statusUpdated'));
      } else {
        toast.error(t('ads.errorUpdateStatusDetail') + (data.error || t('ads.errorUnknown')));
      }
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error(t('ads.errorUpdateStatus'));
    }
  };

  // Bulk actions
  const handleBulkStatus = async (newStatus) => {
    const ids = [...selectedIds];
    const label = { ACTIVE: 'Activo', PAUSED: 'Pausado', ARCHIVED: 'Archivado' }[newStatus];
    let successCount = 0;

    await Promise.all(ids.map(async (id) => {
      try {
        const res = await fetch(`${API_URL}/ads/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus })
        });
        const data = await res.json();
        if (data.success) successCount++;
      } catch (e) { /* skip */ }
    }));

    if (successCount > 0) {
      setAds(prev => prev.map(a => ids.includes(a._id) ? { ...a, status: newStatus } : a));
      toast.success(`${successCount} anuncios → ${label}`);
    }
    setSelectedIds(new Set());
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (!window.confirm(`¿Eliminar ${ids.length} anuncio${ids.length > 1 ? 's' : ''}?`)) return;
    let successCount = 0;

    await Promise.all(ids.map(async (id) => {
      try {
        const res = await fetch(`${API_URL}/ads/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (data.success) successCount++;
      } catch (e) { /* skip */ }
    }));

    if (successCount > 0) {
      setAds(prev => prev.filter(a => !ids.includes(a._id)));
      toast.success(`${successCount} anuncio${successCount > 1 ? 's' : ''} eliminado${successCount > 1 ? 's' : ''}`);
    }
    setSelectedIds(new Set());
  };

  // Selection helpers
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredAds.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAds.map(a => a._id)));
    }
  };

  // Direct link handlers
  const handleSetDirectLink = async (adId) => {
    if (!directLinkInput.trim()) return;
    try {
      const res = await fetch(`${API_URL}/ads/${adId}/direct-link`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: directLinkInput.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setAds(prev => prev.map(a => a._id === adId
          ? { ...a, directLink: { url: directLinkInput.trim(), trackCode: data.data.trackCode } }
          : a
        ));
        if (selectedAd?._id === adId) {
          setSelectedAd(prev => ({ ...prev, directLink: { url: directLinkInput.trim(), trackCode: data.data.trackCode } }));
        }
        navigator.clipboard.writeText(data.data.trackedUrl);
        toast.success('Link guardado y copiado');
        setSettingDirectLink(null);
        setDirectLinkInput('');
      } else {
        toast.error(data.error || 'Error');
      }
    } catch (err) {
      toast.error('Error al guardar el link');
    }
  };

  const handleRemoveDirectLink = async (adId) => {
    try {
      const res = await fetch(`${API_URL}/ads/${adId}/direct-link`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setAds(prev => prev.map(a => a._id === adId ? { ...a, directLink: undefined } : a));
        if (selectedAd?._id === adId) {
          setSelectedAd(prev => ({ ...prev, directLink: undefined }));
        }
        toast.success('Link eliminado');
      }
    } catch (err) {
      toast.error('Error al eliminar el link');
    }
  };

  const copyTrackedUrl = (trackCode) => {
    const baseUrl = process.env.REACT_APP_BASE_URL || 'https://agente.hanlob.com.mx';
    navigator.clipboard.writeText(`${baseUrl}/r/d/${trackCode}`);
    toast.success('Link copiado');
  };

  // Filter ads by search query, status, and date
  const filteredAds = (() => {
    let result = ads;

    // Status filter
    if (statusFilter !== 'ALL') {
      result = result.filter(ad => ad.status === statusFilter);
    }

    // Date range filter
    if (dateFrom) {
      const from = new Date(dateFrom);
      result = result.filter(ad => ad.createdAt && new Date(ad.createdAt) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo + 'T23:59:59');
      result = result.filter(ad => ad.createdAt && new Date(ad.createdAt) <= to);
    }

    // Text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(ad =>
        ad.name?.toLowerCase().includes(q) ||
        ad.fbAdId?.toLowerCase().includes(q) ||
        ad.postId?.toLowerCase().includes(q) ||
        ad.adSetId?.name?.toLowerCase().includes(q) ||
        ad.adSetId?.fbAdSetId?.toLowerCase().includes(q) ||
        ad.adSetId?.campaignId?.name?.toLowerCase().includes(q) ||
        (ad.convoFlowRef && (CONVO_FLOW_NAMES[ad.convoFlowRef] || ad.convoFlowRef).toLowerCase().includes(q))
      );
    }

    return result;
  })();

  const allSelected = filteredAds.length > 0 && selectedIds.size === filteredAds.length;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">{t('ads.title')}</h1>
          <p className="text-gray-400 mt-2">{ads.length} anuncios en total</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={syncFromFacebook}
            disabled={syncing}
            className="px-5 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center space-x-2"
          >
            <svg className={`w-5 h-5 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{syncing ? 'Sincronizando...' : 'Sync Facebook'}</span>
          </button>
          <button
            onClick={() => {
              setEditingAd(null);
              setShowAdModal(true);
            }}
            className="px-6 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center space-x-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>{t('ads.addAd')}</span>
          </button>
        </div>
      </div>

      {/* Search Box */}
      <div className="mb-6">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nombre, FB Ad ID, Post ID, ad set o campaña..."
            className="w-full px-4 py-3 pl-12 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <svg className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-white"
              title="Limpiar búsqueda"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Filters Row */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Status Filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="ALL">Todos los estados</option>
          <option value="ACTIVE">Activo</option>
          <option value="PAUSED">Pausado</option>
          <option value="ARCHIVED">Archivado</option>
        </select>

        {/* Date From */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Desde</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500 [color-scheme:dark]"
          />
        </div>

        {/* Date To */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Hasta</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500 [color-scheme:dark]"
          />
        </div>

        {/* Clear filters */}
        {(statusFilter !== 'ALL' || dateFrom || dateTo) && (
          <button
            onClick={() => { setStatusFilter('ALL'); setDateFrom(''); setDateTo(''); }}
            className="px-3 py-2 text-xs text-gray-400 hover:text-white border border-gray-700/50 rounded-lg hover:bg-gray-700/30 transition-colors"
          >
            Limpiar filtros
          </button>
        )}

        {/* Result count */}
        {(statusFilter !== 'ALL' || dateFrom || dateTo || searchQuery) && (
          <span className="text-xs text-gray-500 ml-auto">
            {filteredAds.length} de {ads.length} anuncios
          </span>
        )}
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="mb-4 p-3 bg-primary-500/10 border border-primary-500/30 rounded-xl flex items-center justify-between">
          <span className="text-sm text-primary-300 font-medium">
            {selectedIds.size} seleccionado{selectedIds.size > 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleBulkStatus('ACTIVE')}
              className="px-3 py-1.5 text-xs font-medium bg-green-500/20 text-green-300 border border-green-500/30 rounded-lg hover:bg-green-500/30 transition-colors"
            >
              Activar
            </button>
            <button
              onClick={() => handleBulkStatus('PAUSED')}
              className="px-3 py-1.5 text-xs font-medium bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/30 transition-colors"
            >
              Pausar
            </button>
            <button
              onClick={() => handleBulkStatus('ARCHIVED')}
              className="px-3 py-1.5 text-xs font-medium bg-gray-500/20 text-gray-300 border border-gray-500/30 rounded-lg hover:bg-gray-500/30 transition-colors"
            >
              Archivar
            </button>
            <div className="w-px h-6 bg-gray-700 mx-1"></div>
            <button
              onClick={handleBulkDelete}
              className="px-3 py-1.5 text-xs font-medium bg-red-500/20 text-red-300 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors"
            >
              Eliminar
            </button>
            <div className="w-px h-6 bg-gray-700 mx-1"></div>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center">
          <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-400 mt-4">{t('ads.loading')}</p>
        </div>
      ) : filteredAds.length === 0 ? (
        <div className="p-12 text-center bg-gray-800/50 border border-gray-700/50 rounded-xl">
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-700/50 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {searchQuery ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
              )}
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">
            {searchQuery ? 'Sin resultados' : t('ads.noAds')}
          </h3>
          <p className="text-gray-400">
            {searchQuery ? `No se encontraron anuncios para "${searchQuery}"` : t('ads.emptyDescription')}
          </p>
        </div>
      ) : (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full table-fixed">
              <thead className="bg-gray-900/50">
                <tr>
                  <th className="px-3 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded bg-gray-900/50 border-gray-600 text-primary-500 focus:ring-primary-500 cursor-pointer"
                    />
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase w-[18%]">{t('common.ad')}</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase w-[13%]">Ad Set</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase w-[16%]">{t('common.campaign')}</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase w-[14%]">Flujo</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase w-[12%]">Link Directo</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase w-[10%]">{t('common.status')}</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-gray-400 uppercase w-[7%]">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/30">
                {filteredAds.map((ad) => (
                  <tr key={ad._id} className={`hover:bg-gray-700/20 transition-colors ${selectedIds.has(ad._id) ? 'bg-primary-500/5' : ''}`}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(ad._id)}
                        onChange={() => toggleSelect(ad._id)}
                        className="w-4 h-4 rounded bg-gray-900/50 border-gray-600 text-primary-500 focus:ring-primary-500 cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 max-w-[200px]">
                      <div className="text-sm font-medium text-white truncate" title={ad.name}>{ad.name}</div>
                      <code className="text-xs text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded mt-1 inline-block truncate max-w-full">
                        {ad.fbAdId}
                      </code>
                    </td>
                    <td className="px-4 py-3 max-w-[150px]">
                      <span className="text-sm text-gray-300 block truncate" title={ad.adSetId?.name || '-'}>{ad.adSetId?.name || '-'}</span>
                    </td>
                    <td className="px-4 py-3 max-w-[180px]">
                      <span className="text-sm text-gray-300 block truncate" title={ad.adSetId?.campaignId?.name || '-'}>{ad.adSetId?.campaignId?.name || '-'}</span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-col gap-1">
                        {ad.convoFlowRef ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 whitespace-nowrap w-fit">
                            {CONVO_FLOW_NAMES[ad.convoFlowRef] || ad.convoFlowRef}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-600">—</span>
                        )}
                        {ad.promoId && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 whitespace-nowrap w-fit">
                            {ad.promoId.name || 'Promo'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {settingDirectLink === ad._id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={directLinkInput}
                            onChange={(e) => setDirectLinkInput(e.target.value)}
                            placeholder="URL destino..."
                            className="w-40 px-2 py-1 text-xs bg-gray-900/50 border border-gray-600 rounded text-white"
                            onKeyDown={(e) => e.key === 'Enter' && handleSetDirectLink(ad._id)}
                          />
                          <button onClick={() => handleSetDirectLink(ad._id)} className="p-1 text-green-400 hover:bg-green-500/20 rounded" title="Guardar">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          </button>
                          <button onClick={() => { setSettingDirectLink(null); setDirectLinkInput(''); }} className="p-1 text-gray-400 hover:bg-gray-500/20 rounded" title="Cancelar">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ) : ad.directLink?.trackCode ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => copyTrackedUrl(ad.directLink.trackCode)}
                            className="text-xs font-medium px-2 py-1 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 transition-colors"
                            title={ad.directLink.url}
                          >
                            Copiar link
                          </button>
                          <button
                            onClick={() => { setSettingDirectLink(ad._id); setDirectLinkInput(ad.directLink.url || ''); }}
                            className="p-1 text-gray-500 hover:text-white rounded"
                            title="Editar"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                          <button
                            onClick={() => handleRemoveDirectLink(ad._id)}
                            className="p-1 text-gray-500 hover:text-red-400 rounded"
                            title="Eliminar link"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setSettingDirectLink(ad._id); setDirectLinkInput(''); }}
                          className="text-xs text-gray-500 hover:text-cyan-300 transition-colors"
                        >
                          + Asignar
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <select
                        value={ad.status}
                        onChange={(e) => handleStatusChange(ad._id, e.target.value)}
                        className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border-2 transition-colors cursor-pointer ${STATUS_STYLE[ad.status] || STATUS_STYLE.ARCHIVED}`}
                      >
                        <option value="ACTIVE">{t('ads.statusActive')}</option>
                        <option value="PAUSED">{t('ads.statusPaused')}</option>
                        <option value="ARCHIVED">{t('ads.statusArchived')}</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end space-x-1">
                        <button
                          onClick={() => setSelectedAd(ad)}
                          className="px-2 py-1 text-xs text-green-400 hover:bg-green-500/20 rounded-lg transition-colors"
                        >
                          Detalle
                        </button>
                        <button
                          onClick={() => {
                            setEditingAd(ad);
                            setShowAdModal(true);
                          }}
                          className="p-1.5 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors"
                          title={t('common.edit')}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteAd(ad)}
                          className="p-1.5 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                          title={t('common.delete')}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Details Modal */}
      {selectedAd && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">
                {t('ads.adDetails')}
              </h2>
              <button
                onClick={() => setSelectedAd(null)}
                className="p-2 rounded-lg text-gray-400 hover:bg-gray-700/50 hover:text-white transition-colors"
                title="Cerrar"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-6">
                {/* Basic Information */}
                <div>
                  <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                    {t('ads.basicInfo')}
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">{t('common.name')}</p>
                      <p className="text-sm text-white mt-1">{selectedAd.name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">FB Ad ID</p>
                      <p className="text-sm text-white mt-1">
                        <code className="bg-purple-500/10 text-purple-400 px-2 py-1 rounded">{selectedAd.fbAdId}</code>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">{t('common.status')}</p>
                      <p className="text-sm mt-1">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          selectedAd.status === 'ACTIVE' ? "bg-green-500/20 text-green-300" : "bg-gray-500/20 text-gray-400"
                        }`}>
                          {selectedAd.status}
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Ad Set</p>
                      <p className="text-sm text-white mt-1">{selectedAd.adSetId?.name || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">{t('common.campaign')}</p>
                      <p className="text-sm text-white mt-1">{selectedAd.adSetId?.campaignId?.name || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Flujo</p>
                      <p className="text-sm text-white mt-1">
                        {selectedAd.convoFlowRef ? (
                          <span className="bg-indigo-500/10 text-indigo-300 px-2 py-1 rounded">
                            {CONVO_FLOW_NAMES[selectedAd.convoFlowRef] || selectedAd.convoFlowRef}
                          </span>
                        ) : (
                          <span className="text-gray-500">Sin asignar</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">{t('ads.associatedProducts')}</p>
                      <p className="text-sm text-white mt-1">
                        <span className="bg-blue-500/20 text-blue-300 px-2 py-1 rounded">
                          {selectedAd.productIds?.length || 0} {t('ads.productsCount')}
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">{t('ads.internalId')}</p>
                      <p className="text-sm text-gray-400 mt-1">
                        <code className="text-xs">{selectedAd._id}</code>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Direct Link */}
                <div>
                  <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                    Link Directo
                  </h3>
                  {selectedAd.directLink?.trackCode ? (
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">URL Destino</p>
                        <a href={selectedAd.directLink.url} target="_blank" rel="noopener noreferrer"
                          className="text-sm text-blue-400 hover:text-blue-300 mt-1 block truncate">
                          {selectedAd.directLink.url}
                        </a>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Link de Seguimiento</p>
                        <div className="flex items-center gap-2 mt-1">
                          <code className="text-sm text-cyan-400 bg-cyan-500/10 px-3 py-1.5 rounded flex-1 truncate">
                            {(process.env.REACT_APP_BASE_URL || 'https://agente.hanlob.com.mx') + '/r/d/' + selectedAd.directLink.trackCode}
                          </code>
                          <button
                            onClick={() => copyTrackedUrl(selectedAd.directLink.trackCode)}
                            className="px-3 py-1.5 text-xs font-medium bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-lg hover:bg-cyan-500/30 transition-colors whitespace-nowrap"
                          >
                            Copiar
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setSettingDirectLink(selectedAd._id); setDirectLinkInput(selectedAd.directLink.url); }}
                          className="px-3 py-1.5 text-xs text-gray-400 border border-gray-700 rounded-lg hover:bg-gray-700/30"
                        >
                          Cambiar URL
                        </button>
                        <button
                          onClick={() => handleRemoveDirectLink(selectedAd._id)}
                          className="px-3 py-1.5 text-xs text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10"
                        >
                          Eliminar link
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-gray-400 mb-3">Este anuncio no tiene un link directo asignado.</p>
                      {settingDirectLink === selectedAd._id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={directLinkInput}
                            onChange={(e) => setDirectLinkInput(e.target.value)}
                            placeholder="URL destino (ej: mercadolibre.com.mx/...)"
                            className="flex-1 px-3 py-2 text-sm bg-gray-900/50 border border-gray-600 rounded-lg text-white"
                            onKeyDown={(e) => e.key === 'Enter' && handleSetDirectLink(selectedAd._id)}
                          />
                          <button
                            onClick={() => handleSetDirectLink(selectedAd._id)}
                            className="px-4 py-2 text-xs font-medium bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-lg hover:bg-cyan-500/30"
                          >
                            Guardar
                          </button>
                          <button
                            onClick={() => { setSettingDirectLink(null); setDirectLinkInput(''); }}
                            className="px-3 py-2 text-xs text-gray-400 hover:text-white"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setSettingDirectLink(selectedAd._id); setDirectLinkInput(''); }}
                          className="px-4 py-2 text-xs font-medium bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 rounded-lg hover:bg-cyan-500/20"
                        >
                          + Asignar link directo
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Creative */}
                {selectedAd.creative && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      {t('ads.creative')}
                    </h3>
                    <div className="space-y-4">
                      {selectedAd.creative.headline && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">{t('ads.headline')}</p>
                          <p className="text-base text-white mt-1 font-medium">{selectedAd.creative.headline}</p>
                        </div>
                      )}
                      {selectedAd.creative.body && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">{t('ads.mainText')}</p>
                          <p className="text-sm text-gray-300 mt-1 bg-gray-900/50 p-3 rounded">
                            {selectedAd.creative.body}
                          </p>
                        </div>
                      )}
                      {selectedAd.creative.description && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">{t('common.description')}</p>
                          <p className="text-sm text-gray-300 mt-1">{selectedAd.creative.description}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4">
                        {selectedAd.creative.callToAction && (
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">{t('ads.callToAction')}</p>
                            <p className="text-sm text-white mt-1">
                              <span className="bg-green-500/10 text-green-400 px-2 py-1 rounded">
                                {selectedAd.creative.callToAction}
                              </span>
                            </p>
                          </div>
                        )}
                        {selectedAd.creative.linkUrl && (
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">{t('ads.destinationUrl')}</p>
                            <a
                              href={selectedAd.creative.linkUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-400 hover:text-blue-300 mt-1 block truncate"
                            >
                              {selectedAd.creative.linkUrl}
                            </a>
                          </div>
                        )}
                      </div>
                      {selectedAd.creative.imageUrl && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">{t('common.image')}</p>
                          <div className="mt-2">
                            <img
                              src={selectedAd.creative.imageUrl}
                              alt="Ad creative"
                              className="rounded-lg max-w-full h-auto"
                            />
                          </div>
                        </div>
                      )}
                      {selectedAd.creative.videoUrl && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">{t('ads.video')}</p>
                          <p className="text-sm text-blue-400 mt-1">{selectedAd.creative.videoUrl}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Tracking */}
                {selectedAd.tracking && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      {t('ads.trackingSection')}
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {['utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm', 'fbPixelId'].map(key => (
                        selectedAd.tracking[key] ? (
                          <div key={key}>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">{key.replace(/([A-Z])/g, ' $1').replace('utm ', 'UTM ')}</p>
                            <p className="text-sm text-white mt-1">
                              <code className="bg-gray-900/50 px-2 py-1 rounded">{selectedAd.tracking[key]}</code>
                            </p>
                          </div>
                        ) : null
                      ))}
                    </div>
                  </div>
                )}

                {/* Bot Response Customization */}
                <div>
                  <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                    {t('ads.botCustomization')}
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">{t('ads.adAngle')}</p>
                      <p className="text-sm text-white mt-1">
                        {selectedAd.adAngle ? (
                          <span className="bg-purple-500/20 text-purple-300 px-2 py-1 rounded">
                            {{
                              'price_sensitive': t('ads.anglePriceSensitive'),
                              'quality_premium': t('ads.angleQualityPremium'),
                              'urgency_offer': t('ads.angleUrgencyOffer'),
                              'problem_pain': t('ads.angleProblemPain'),
                              'bulk_b2b': t('ads.angleBulkB2b'),
                              'diy_ease': t('ads.angleDiyEase'),
                              'comparison_switching': t('ads.angleComparisonSwitching')
                            }[selectedAd.adAngle] || selectedAd.adAngle}
                          </span>
                        ) : (
                          <span className="text-gray-500">{t('ads.notConfigured')}</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">{t('ads.audienceType')}</p>
                      <p className="text-sm text-white mt-1">
                        {selectedAd.adIntent?.audienceType || <span className="text-gray-500">{t('ads.notConfigured')}</span>}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">{t('ads.primaryUse')}</p>
                      <p className="text-sm text-white mt-1">
                        {selectedAd.adIntent?.primaryUse || <span className="text-gray-500">{t('ads.notConfigured')}</span>}
                      </p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs text-gray-500 uppercase tracking-wide">{t('ads.offerHook')}</p>
                      <p className="text-sm mt-1">
                        {selectedAd.adIntent?.offerHook ? (
                          <span className="bg-green-500/20 text-green-300 px-3 py-2 rounded block">
                            {selectedAd.adIntent.offerHook}
                          </span>
                        ) : (
                          <span className="text-gray-500">{t('ads.notConfigured')}</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Metrics */}
                {selectedAd.metrics && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      {t('ads.metricsSection')}
                    </h3>
                    <div className="grid grid-cols-3 gap-4">
                      {[
                        { key: 'impressions', label: t('ads.impressionsLabel') },
                        { key: 'clicks', label: t('ads.clicksLabel') },
                        { key: 'conversions', label: t('ads.conversionsLabel') },
                        { key: 'spend', label: t('ads.spendLabel'), prefix: '$' },
                        { key: 'reach', label: t('ads.reachLabel') },
                        { key: 'ctr', label: t('ads.ctrLabel'), suffix: '%' },
                        { key: 'cpc', label: t('ads.cpcLabel'), prefix: '$' },
                        { key: 'cpm', label: t('ads.cpmLabel'), prefix: '$' },
                      ].map(m => {
                        const val = selectedAd.metrics[m.key];
                        if (val === undefined || val === null) return null;
                        return (
                          <div key={m.key} className="bg-gray-900/50 p-3 rounded">
                            <p className="text-xs text-gray-500 uppercase tracking-wide">{m.label}</p>
                            <p className="text-2xl font-bold text-white mt-1">{m.prefix || ''}{val}{m.suffix || ''}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Dates */}
                {(selectedAd.createdAt || selectedAd.updatedAt) && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      {t('ads.systemInfo')}
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {selectedAd.createdAt && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">{t('ads.createdAt')}</p>
                          <p className="text-sm text-white mt-1">
                            {new Date(selectedAd.createdAt).toLocaleString(locale)}
                          </p>
                        </div>
                      )}
                      {selectedAd.updatedAt && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">{t('ads.updatedAt')}</p>
                          <p className="text-sm text-white mt-1">
                            {new Date(selectedAd.updatedAt).toLocaleString(locale)}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-gray-700/50 flex justify-end">
              <button
                onClick={() => setSelectedAd(null)}
                className="px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ad Modal */}
      {showAdModal && (
        <AdModal
          ad={editingAd}
          adSets={adSets}
          onSave={handleSaveAd}
          onClose={() => {
            setShowAdModal(false);
            setEditingAd(null);
          }}
        />
      )}
    </div>
  );
}

export default AdsView;
