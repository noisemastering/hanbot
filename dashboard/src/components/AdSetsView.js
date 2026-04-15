import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import AdSetModal from './AdSetModal';
import { useTranslation } from '../i18n';
import API from '../api';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function AdSetsView() {
  const { t } = useTranslation();
  const [adSets, setAdSets] = useState([]);
  const [ads, setAds] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAdSet, setSelectedAdSet] = useState(null);
  const [showAdSetModal, setShowAdSetModal] = useState(false);
  const [editingAdSet, setEditingAdSet] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeExpanded, setActiveExpanded] = useState(true);
  const [pausedExpanded, setPausedExpanded] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchAll();
  }, []);

  const syncFromFacebook = async () => {
    setSyncing(true);
    try {
      const { data } = await API.post('/campaigns/sync-facebook');
      toast.success(`Synced: ${data.created || 0} created, ${data.updated || 0} updated`);
      await fetchAll();
    } catch (err) {
      toast.error('Sync failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setSyncing(false);
    }
  };


  const fetchAll = async () => {
    setLoading(true);
    try {
      const [setsRes, adsRes, campsRes] = await Promise.all([
        fetch(`${API_URL}/adsets`).then(r => r.json()),
        fetch(`${API_URL}/ads`).then(r => r.json()),
        fetch(`${API_URL}/campaigns`).then(r => r.json())
      ]);
      if (setsRes.success) setAdSets(setsRes.data || []);
      if (adsRes.success) setAds(adsRes.data || []);
      if (campsRes.success) setCampaigns(campsRes.data || []);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAdSet = async (adSetData) => {
    try {
      const url = editingAdSet
        ? `${API_URL}/adsets/${editingAdSet._id}`
        : `${API_URL}/adsets`;
      const method = editingAdSet ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adSetData)
      });

      const data = await res.json();
      if (data.success) {
        await fetchAll();
        setShowAdSetModal(false);
        setEditingAdSet(null);
        toast.success(editingAdSet ? t('adSets.updatedSuccess') : t('adSets.createdSuccess'));
      } else {
        toast.error(t('adSets.errorSaveDetail') + (data.error || t('ads.errorUnknown')));
      }
    } catch (error) {
      console.error("Error saving ad set:", error);
      toast.error(t('adSets.errorSave'));
    }
  };


  // Build ads lookup by adSetId
  const adsBySet = {};
  for (const ad of ads) {
    const setId = ad.adSetId?._id || 'unassigned';
    if (!adsBySet[setId]) adsBySet[setId] = [];
    adsBySet[setId].push(ad);
  }

  // Filter ad sets by search query
  const filteredAdSets = (() => {
    if (!searchQuery.trim()) return adSets;
    const q = searchQuery.toLowerCase().trim();
    return adSets.filter(adSet =>
      adSet.name?.toLowerCase().includes(q) ||
      adSet.fbAdSetId?.toLowerCase().includes(q) ||
      adSet.campaignId?.name?.toLowerCase().includes(q) ||
      (adsBySet[adSet._id] || []).some(ad =>
        ad.name?.toLowerCase().includes(q) ||
        ad.fbAdId?.toLowerCase().includes(q)
      )
    );
  })();

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">{t('adSets.title')}</h1>
          <p className="text-gray-400 mt-2">{t('adSets.groupedByCampaign')}</p>
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
            onClick={() => { setEditingAdSet(null); setShowAdSetModal(true); }}
            className="px-6 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center space-x-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>{t('adSets.addAdSet')}</span>
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
            placeholder="Buscar por nombre, FB AdSet ID, campaña o anuncio..."
            className="w-full px-4 py-3 pl-12 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <svg className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-white" title="Limpiar búsqueda">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-400 mt-4">{t('adSets.loading')}</p>
        </div>
      ) : filteredAdSets.length === 0 ? (
        <div className="p-12 text-center bg-gray-800/50 border border-gray-700/50 rounded-xl">
          <h3 className="text-lg font-semibold text-white mb-2">
            {searchQuery ? 'Sin resultados' : t('adSets.noAdSets')}
          </h3>
          <p className="text-gray-400">
            {searchQuery ? `No se encontraron ad sets para "${searchQuery}"` : t('adSets.emptyDescription')}
          </p>
        </div>
      ) : (() => {
        const activeAdSets = filteredAdSets.filter(s => s.status === 'ACTIVE');
        const pausedAdSets = filteredAdSets.filter(s => s.status !== 'ACTIVE');

        const renderRow = (adSet) => {
          const setAds = adsBySet[adSet._id] || [];
          const activeAds = setAds.filter(a => a.status === 'ACTIVE').length;
          return (
            <tr key={adSet._id} className="hover:bg-gray-700/20 transition-colors">
              <td className="px-4 py-3 max-w-[200px]">
                <div className="text-sm font-medium text-white truncate" title={adSet.name}>{adSet.name}</div>
                <code className="text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded mt-1 inline-block truncate max-w-full">{adSet.fbAdSetId}</code>
              </td>
              <td className="px-4 py-3 max-w-[180px]">
                <span className="text-sm text-gray-300 block truncate" title={adSet.campaignId?.name || '-'}>{adSet.campaignId?.name || '-'}</span>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <span className="text-sm text-gray-300">{activeAds}/{setAds.length} {t('adSets.activeAds')}</span>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                  adSet.status === 'ACTIVE' ? "bg-green-500/20 text-green-300"
                    : adSet.status === 'PAUSED' ? "bg-yellow-500/20 text-yellow-300"
                    : "bg-gray-500/20 text-gray-400"
                }`}>
                  {adSet.status === 'ACTIVE' ? t('adSets.statusActive') : adSet.status === 'PAUSED' ? t('adSets.statusPaused') : adSet.status}
                </span>
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-right">
                <div className="flex items-center justify-end space-x-1">
                  <button onClick={() => setSelectedAdSet(adSet)} className="p-1.5 text-green-400 hover:bg-green-500/20 rounded-lg transition-colors" title={t('adSets.viewDetails')}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                  <button onClick={() => { setEditingAdSet(adSet); setShowAdSetModal(true); }} className="p-1.5 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors" title={t('common.edit')}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          );
        };

        const renderTable = (rows, label, count, borderClass, expanded, onToggle) => (
          <div className={`bg-gray-800/50 border ${borderClass} rounded-xl overflow-hidden`}>
            <button
              onClick={onToggle}
              className="w-full px-6 py-3 flex items-center gap-3 hover:bg-gray-700/30 transition-colors"
            >
              <svg className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <div className={`w-2 h-2 rounded-full ${borderClass === 'border-green-500/20' ? 'bg-green-400' : 'bg-gray-500'}`}></div>
              <h2 className={`text-lg font-bold ${borderClass === 'border-green-500/20' ? 'text-white' : 'text-gray-400'}`}>{label}</h2>
              <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">{count}</span>
            </button>
            {expanded && (
              <div className="overflow-x-auto border-t border-gray-700/50">
                <table className="w-full table-fixed">
                  <thead className="bg-gray-900/50">
                    <tr>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase w-[25%]">Ad Set</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase w-[22%]">{t('common.campaign')}</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase w-[12%]">Anuncios</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase w-[12%]">{t('common.status')}</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-gray-400 uppercase w-[10%]">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/30">
                    {rows}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );

        return (
          <div className="space-y-6">
            {activeAdSets.length > 0 && renderTable(
              activeAdSets.map(renderRow),
              'Activos',
              activeAdSets.length,
              'border-green-500/20',
              activeExpanded,
              () => setActiveExpanded(p => !p)
            )}
            {pausedAdSets.length > 0 && renderTable(
              pausedAdSets.map(renderRow),
              'Pausados / Inactivos',
              pausedAdSets.length,
              'border-gray-700/50',
              pausedExpanded,
              () => setPausedExpanded(p => !p)
            )}
          </div>
        );
      })()}

      {/* Ad Set Details Modal */}
      {selectedAdSet && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">{t('adSets.adSetDetails')}</h2>
              <button
                onClick={() => setSelectedAdSet(null)}
                className="p-2 rounded-lg text-gray-400 hover:bg-gray-700/50 hover:text-white transition-colors"
                title="Cerrar"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-6">
                {/* Basic Information */}
                <div>
                  <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                    {t('adSets.basicInfo')}
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">{t('common.name')}</p>
                      <p className="text-sm text-white mt-1">{selectedAdSet.name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">FB AdSet ID</p>
                      <p className="text-sm text-white mt-1">
                        <code className="bg-blue-500/10 text-blue-400 px-2 py-1 rounded">{selectedAdSet.fbAdSetId}</code>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">{t('common.status')}</p>
                      <p className="text-sm mt-1">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          selectedAdSet.status === 'ACTIVE' ? "bg-green-500/20 text-green-300" : "bg-gray-500/20 text-gray-400"
                        }`}>
                          {selectedAdSet.status}
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">{t('common.campaign')}</p>
                      <p className="text-sm text-white mt-1">{selectedAdSet.campaignId?.name || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">{t('adSets.internalId')}</p>
                      <p className="text-sm text-gray-400 mt-1">
                        <code className="text-xs">{selectedAdSet._id}</code>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Targeting */}
                {selectedAdSet.targeting && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      {t('adSets.targetingSection')}
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {selectedAdSet.targeting.locations && selectedAdSet.targeting.locations.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">{t('adSets.locations')}</p>
                          <p className="text-sm text-white mt-1">{selectedAdSet.targeting.locations.join(', ')}</p>
                        </div>
                      )}
                      {(selectedAdSet.targeting.ageMin || selectedAdSet.targeting.ageMax) && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">{t('adSets.age')}</p>
                          <p className="text-sm text-white mt-1">
                            {selectedAdSet.targeting.ageMin || 18} - {selectedAdSet.targeting.ageMax || 65}
                          </p>
                        </div>
                      )}
                      {selectedAdSet.targeting.gender && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">{t('adSets.gender')}</p>
                          <p className="text-sm text-white mt-1">{selectedAdSet.targeting.gender}</p>
                        </div>
                      )}
                      {selectedAdSet.targeting.interests && selectedAdSet.targeting.interests.length > 0 && (
                        <div className="col-span-2">
                          <p className="text-xs text-gray-500 uppercase tracking-wide">{t('adSets.interests')}</p>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {selectedAdSet.targeting.interests.map((interest, idx) => (
                              <span key={idx} className="bg-purple-500/10 text-purple-400 px-2 py-1 rounded text-xs">
                                {interest}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Budget & Optimization */}
                {(selectedAdSet.dailyBudget || selectedAdSet.lifetimeBudget || selectedAdSet.optimizationGoal || selectedAdSet.billingEvent || selectedAdSet.bidAmount) && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      {t('adSets.budgetAndOptimization')}
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {selectedAdSet.dailyBudget && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">{t('adSets.dailyBudget')}</p>
                          <p className="text-sm text-white mt-1">${selectedAdSet.dailyBudget}</p>
                        </div>
                      )}
                      {selectedAdSet.lifetimeBudget && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">{t('adSets.lifetimeBudget')}</p>
                          <p className="text-sm text-white mt-1">${selectedAdSet.lifetimeBudget}</p>
                        </div>
                      )}
                      {selectedAdSet.optimizationGoal && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">{t('adSets.optimizationGoal')}</p>
                          <p className="text-sm text-white mt-1">{selectedAdSet.optimizationGoal}</p>
                        </div>
                      )}
                      {selectedAdSet.billingEvent && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">{t('adSets.billingEvent')}</p>
                          <p className="text-sm text-white mt-1">{selectedAdSet.billingEvent}</p>
                        </div>
                      )}
                      {selectedAdSet.bidAmount && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">{t('adSets.bid')}</p>
                          <p className="text-sm text-white mt-1">${selectedAdSet.bidAmount}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Metrics */}
                {selectedAdSet.metrics && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                      {t('adSets.metricsSection')}
                    </h3>
                    <div className="grid grid-cols-3 gap-4">
                      {[
                        { key: 'impressions', label: t('adSets.impressionsLabel') },
                        { key: 'clicks', label: t('adSets.clicksLabel') },
                        { key: 'conversions', label: t('adSets.conversionsLabel') },
                        { key: 'spend', label: t('adSets.spendLabel'), prefix: '$' },
                        { key: 'reach', label: t('adSets.reachLabel') },
                        { key: 'ctr', label: t('adSets.ctrLabel'), suffix: '%' },
                      ].map(m => {
                        const val = selectedAdSet.metrics[m.key];
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
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-700/50 flex justify-end">
              <button
                onClick={() => setSelectedAdSet(null)}
                className="px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AdSet Modal */}
      {showAdSetModal && (
        <AdSetModal
          adSet={editingAdSet}
          campaigns={campaigns}
          onSave={handleSaveAdSet}
          onClose={() => {
            setShowAdSetModal(false);
            setEditingAdSet(null);
          }}
        />
      )}

    </div>
  );
}

export default AdSetsView;
