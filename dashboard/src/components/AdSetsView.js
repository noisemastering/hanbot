import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import AdSetModal from './AdSetModal';
import AdModal from './AdModal';
import { useTranslation } from '../i18n';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const STATUS_STYLE = {
  ACTIVE: "bg-green-500/10 border-green-500/30 text-green-300 hover:bg-green-500/20",
  PAUSED: "bg-yellow-500/10 border-yellow-500/30 text-yellow-300 hover:bg-yellow-500/20",
  ARCHIVED: "bg-gray-500/10 border-gray-500/30 text-gray-400 hover:bg-gray-500/20"
};

function AdSetsView() {
  const { t } = useTranslation();
  const [adSets, setAdSets] = useState([]);
  const [ads, setAds] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAdSet, setSelectedAdSet] = useState(null);
  const [showAdSetModal, setShowAdSetModal] = useState(false);
  const [editingAdSet, setEditingAdSet] = useState(null);
  const [showAdModal, setShowAdModal] = useState(false);
  const [editingAd, setEditingAd] = useState(null);
  const [expandedSets, setExpandedSets] = useState(new Set());

  useEffect(() => {
    fetchAll();
  }, []);


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
        await fetchAll();
        setShowAdModal(false);
        setEditingAd(null);
        toast.success(editingAd ? t('adSets.adUpdatedSuccess') : t('adSets.adCreatedSuccess'));
      } else {
        toast.error(t('adSets.adErrorSaveDetail') + (data.error || t('ads.errorUnknown')));
      }
    } catch (error) {
      console.error("Error saving ad:", error);
      toast.error(t('adSets.adErrorSave'));
    }
  };

  const handleAdStatusChange = async (adId, newStatus) => {
    try {
      const res = await fetch(`${API_URL}/ads/${adId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });

      const data = await res.json();
      if (data.success) {
        await fetchAll();
        toast.success(t('adSets.statusUpdated'));
      } else {
        toast.error(t('adSets.errorUpdateStatus'));
      }
    } catch (error) {
      console.error("Error updating ad status:", error);
      toast.error(t('adSets.errorUpdateStatus'));
    }
  };

  const toggleSet = (setId) => {
    setExpandedSets(prev => {
      const next = new Set(prev);
      if (next.has(setId)) next.delete(setId);
      else next.add(setId);
      return next;
    });
  };

  // Build ads lookup by adSetId
  const adsBySet = {};
  for (const ad of ads) {
    const setId = ad.adSetId?._id || 'unassigned';
    if (!adsBySet[setId]) adsBySet[setId] = [];
    adsBySet[setId].push(ad);
  }

  // Group ad sets by campaign
  const buildHierarchy = () => {
    const campaignGroups = {};

    for (const adSet of adSets) {
      const campId = adSet.campaignId?._id || 'no-campaign';
      const campName = adSet.campaignId?.name || t('adSets.noCampaign');

      if (!campaignGroups[campId]) {
        campaignGroups[campId] = { name: campName, adSets: [] };
      }
      campaignGroups[campId].adSets.push(adSet);
    }

    return campaignGroups;
  };

  const hierarchy = buildHierarchy();

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">{t('adSets.title')}</h1>
          <p className="text-gray-400 mt-2">{t('adSets.groupedByCampaign')}</p>
        </div>
        <button
          onClick={() => {
            setEditingAdSet(null);
            setShowAdSetModal(true);
          }}
          className="px-6 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center space-x-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>{t('adSets.addAdSet')}</span>
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-400 mt-4">{t('adSets.loading')}</p>
        </div>
      ) : adSets.length === 0 ? (
        <div className="p-12 text-center bg-gray-800/50 border border-gray-700/50 rounded-xl">
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-700/50 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">{t('adSets.noAdSets')}</h3>
          <p className="text-gray-400">{t('adSets.emptyDescription')}</p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(hierarchy).map(([campId, campaign]) => (
            <div key={campId}>
              {/* Campaign Header */}
              <div className="flex items-center gap-3 mb-3">
                <div className="w-2 h-2 rounded-full bg-blue-400"></div>
                <h2 className="text-lg font-bold text-white">{campaign.name}</h2>
                <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">
                  {campaign.adSets.length} ad set{campaign.adSets.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Ad Sets under this campaign */}
              <div className="space-y-3 ml-2">
                {campaign.adSets.map((adSet) => {
                  const isExpanded = expandedSets.has(adSet._id);
                  const setAds = adsBySet[adSet._id] || [];
                  const activeAds = setAds.filter(a => a.status === 'ACTIVE').length;

                  return (
                    <div key={adSet._id} className="bg-gray-800/50 border border-gray-700/50 rounded-lg overflow-hidden">
                      {/* Ad Set Header */}
                      <button
                        onClick={() => toggleSet(adSet._id)}
                        className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/80 hover:bg-gray-700/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <svg
                            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          <span className="font-semibold text-white text-sm">{adSet.name}</span>
                          <code className="text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">
                            {adSet.fbAdSetId}
                          </code>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            adSet.status === 'ACTIVE'
                              ? "bg-green-500/20 text-green-300"
                              : adSet.status === 'PAUSED'
                                ? "bg-yellow-500/20 text-yellow-300"
                                : "bg-gray-500/20 text-gray-400"
                          }`}>
                            {adSet.status === 'ACTIVE' ? t('adSets.statusActive') : adSet.status === 'PAUSED' ? t('adSets.statusPaused') : adSet.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">
                            {activeAds}/{setAds.length} {t('adSets.activeAds')}
                          </span>
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => setSelectedAdSet(adSet)}
                              className="p-1.5 text-purple-400 hover:bg-purple-500/20 rounded-lg transition-colors"
                              title={t('adSets.viewDetails')}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => {
                                setEditingAdSet(adSet);
                                setShowAdSetModal(true);
                              }}
                              className="p-1.5 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors"
                              title={t('common.edit')}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </button>

                      {/* Ads Table */}
                      {isExpanded && (
                        <div className="overflow-x-auto">
                          {setAds.length === 0 ? (
                            <div className="px-4 py-6 text-center text-gray-500 text-sm">
                              {t('adSets.noAdsInSet')}
                            </div>
                          ) : (
                            <table className="w-full">
                              <thead className="bg-gray-900/50">
                                <tr>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">{t('common.ad')}</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase w-32">{t('common.status')}</th>
                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-400 uppercase w-28">{t('common.actions')}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-700/30">
                                {setAds.map((ad) => (
                                  <tr key={ad._id} className="hover:bg-gray-700/20 transition-colors">
                                    <td className="px-4 py-3">
                                      <div className="text-sm font-medium text-white">{ad.name}</div>
                                      <code className="text-xs text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded mt-1 inline-block">
                                        {ad.fbAdId}
                                      </code>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                      <select
                                        value={ad.status}
                                        onChange={(e) => handleAdStatusChange(ad._id, e.target.value)}
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
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Ad Set Details Modal */}
      {selectedAdSet && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">{t('adSets.adSetDetails')}</h2>
              <button
                onClick={() => setSelectedAdSet(null)}
                className="p-2 rounded-lg text-gray-400 hover:bg-gray-700/50 hover:text-white transition-colors"
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

export default AdSetsView;
