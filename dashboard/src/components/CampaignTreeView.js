import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from '../i18n';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

// Recursive component to render a single campaign/adset/ad node and its children
function CampaignNode({ item, onEdit, onDelete, onAddChild, onDetails, onToggleActive, level = 0, expandedNodes, onToggleExpand, parentActive = true, t }) {
  const isExpanded = expandedNodes.has(item._id);
  const hasChildren = item.children && item.children.length > 0;
  const indentPixels = level * 32; // 32px per level

  // Determine item type (campaign, adset, or ad)
  const itemType = item.type || 'campaign';

  // Effective active: campaigns use their own `active`, children inherit from parent
  const effectiveActive = itemType === 'campaign' ? item.active !== false : parentActive;

  // Type badge colors
  const getTypeColor = (type) => {
    switch (type) {
      case 'campaign':
        return 'bg-purple-500/20 text-purple-300';
      case 'adset':
        return 'bg-indigo-500/20 text-indigo-300';
      case 'ad':
        return 'bg-blue-500/20 text-blue-300';
      default:
        return 'bg-gray-500/20 text-gray-300';
    }
  };

  // Type labels
  const getTypeLabel = (type) => {
    switch (type) {
      case 'campaign':
        return t('campaignTree.typeCampaign');
      case 'adset':
        return t('campaignTree.typeAdSet');
      case 'ad':
        return t('campaignTree.typeAd');
      default:
        return t('campaignTree.typeItem');
    }
  };

  return (
    <div className="border-l-2 border-gray-700/50">
      {/* Item Row */}
      <div className="flex items-center justify-between px-6 py-4 hover:bg-gray-700/30 transition-colors" style={{ marginLeft: `${indentPixels}px` }}>
        <div className="flex items-center space-x-4 flex-1">
          {/* Expand/Collapse Button */}
          {hasChildren ? (
            <button
              onClick={() => onToggleExpand(item._id)}
              className="p-1 text-gray-400 hover:text-white transition-colors"
              title={isExpanded ? t('campaignTree.contract') : t('campaignTree.expandNode')}
            >
              <svg className={`w-5 h-5 transform transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <div className="w-7"></div>
          )}

          {/* Item Info */}
          <div className="flex-1">
            <button
              onClick={() => onDetails(item)}
              className="flex items-center space-x-3 cursor-pointer hover:opacity-80 transition-opacity text-left"
              title={t('campaignTree.viewDetailsTooltip')}
            >
              <h3 className="text-sm font-semibold text-white hover:text-indigo-400 transition-colors">{item.name || item.ref || t('campaignTree.noName')}</h3>

              {/* Type Badge */}
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${getTypeColor(itemType)}`}>
                {getTypeLabel(itemType)}
              </span>

              {/* Active Toggle (campaigns only) */}
              {itemType === 'campaign' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleActive(item);
                  }}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    item.active ? 'bg-green-500' : 'bg-gray-600'
                  }`}
                  title={item.active ? t('campaignTree.deactivateCampaign') : t('campaignTree.activateCampaign')}
                >
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    item.active ? 'translate-x-4.5' : 'translate-x-0.5'
                  }`} style={{ transform: item.active ? 'translateX(17px)' : 'translateX(3px)' }} />
                </button>
              )}
              {itemType === 'campaign' && (
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  item.active ? 'bg-green-500/20 text-green-300' : 'bg-gray-500/20 text-gray-400'
                }`}>
                  {item.active ? t('campaignTree.activeFem') : t('campaignTree.inactiveFem')}
                </span>
              )}

              {/* Active/Inactive Badge (for adsets and ads, inherited from campaign) */}
              {itemType !== 'campaign' && (
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  effectiveActive ? 'bg-green-500/20 text-green-300' : 'bg-gray-500/20 text-gray-400'
                }`}>
                  {effectiveActive ? t('common.active') : t('common.inactive')}
                </span>
              )}

              {/* FB ID Badge */}
              {(item.fbCampaignId || item.fbAdSetId || item.fbAdId) && (
                <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded text-xs font-medium flex items-center space-x-1" title="ID de Facebook">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                  <span>{item.fbCampaignId || item.fbAdSetId || item.fbAdId}</span>
                </span>
              )}
            </button>

            {/* Ref (for campaigns) */}
            {item.ref && itemType === 'campaign' && (
              <p className="text-xs text-gray-400 mt-1">Ref: {item.ref}</p>
            )}

            {/* Metrics */}
            {item.metrics && (
              <div className="flex items-center space-x-4 mt-2 text-xs text-gray-400">
                {item.metrics.impressions !== undefined && (
                  <span className="flex items-center space-x-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <span>{item.metrics.impressions.toLocaleString()} {t('campaignTree.impressions')}</span>
                  </span>
                )}
                {item.metrics.clicks !== undefined && (
                  <span className="flex items-center space-x-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                    </svg>
                    <span>{item.metrics.clicks.toLocaleString()} {t('campaignTree.clicks')}</span>
                  </span>
                )}
                {item.metrics.spend !== undefined && (
                  <span className="flex items-center space-x-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>${item.metrics.spend.toLocaleString()} {t('campaignTree.spent')}</span>
                  </span>
                )}
                {item.metrics.conversions !== undefined && (
                  <span className="flex items-center space-x-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>{item.metrics.conversions.toLocaleString()} {t('campaignTree.conversionsLabel')}</span>
                  </span>
                )}
              </div>
            )}

            {/* Budget (for adsets) */}
            {item.budget && itemType === 'adset' && (
              <div className="flex items-center space-x-4 mt-2 text-xs text-gray-400">
                {item.budget.daily && <span>{t('campaignTree.dailyBudget')}: ${item.budget.daily}</span>}
                {item.budget.lifetime && <span>{t('campaignTree.lifetimeBudget')}: ${item.budget.lifetime}</span>}
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2">
          {/* Add Child Button (only for campaigns and adsets) */}
          {itemType !== 'ad' && (
            <button
              onClick={() => onAddChild(item)}
              className="p-2 text-green-400 hover:bg-green-500/20 rounded-lg transition-colors"
              title={itemType === 'campaign' ? t('campaignTree.addAdSetTooltip') : t('campaignTree.addAdTooltip')}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}

          {/* Details Button */}
          <button
            onClick={() => onDetails(item)}
            className="p-2 text-indigo-400 hover:bg-indigo-500/20 rounded-lg transition-colors"
            title={t('campaignTree.viewDetails')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>

          {/* Edit Button */}
          <button
            onClick={() => onEdit(item)}
            className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors"
            title={t('common.edit')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>

          {/* Delete Button */}
          <button
            onClick={() => onDelete(item)}
            className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
            title={t('common.delete')}
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
          {item.children.map((child) => (
            <CampaignNode
              key={child._id}
              item={child}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
              onDetails={onDetails}
              onToggleActive={onToggleActive}
              level={level + 1}
              expandedNodes={expandedNodes}
              onToggleExpand={onToggleExpand}
              parentActive={effectiveActive}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignTreeView({
  campaigns,
  loading,
  onAdd,
  onEdit,
  onDelete,
  onAddChild,
  onDetails,
  editingItem,
  onUpdateCampaign
}) {
  const { t } = useTranslation();
  // Manage expanded nodes state (Set of item IDs)
  // Start with all trees collapsed
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  // Helper function to find path from item to root
  const findPathToRoot = (itemId, campaigns, path = []) => {
    // Recursively search through the tree
    for (const campaign of campaigns) {
      if (campaign._id === itemId) {
        return [...path, campaign._id];
      }
      if (campaign.children && campaign.children.length > 0) {
        const found = findPathToRoot(itemId, campaign.children, [...path, campaign._id]);
        if (found) return found;
      }
    }
    return null;
  };

  // When editing an item, expand the path to that item (collapse all others)
  React.useEffect(() => {
    if (editingItem && campaigns && campaigns.length > 0) {
      const path = findPathToRoot(editingItem._id, campaigns);
      if (path) {
        // Only expand nodes in the path to the editing item
        setExpandedNodes(new Set(path));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingItem, campaigns]);

  // Toggle expand/collapse for a node
  const handleToggleExpand = (itemId) => {
    setExpandedNodes(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(itemId)) {
        newExpanded.delete(itemId);
      } else {
        newExpanded.add(itemId);
      }
      return newExpanded;
    });
  };

  // Toggle campaign active state (optimistic)
  const handleToggleActive = async (campaign) => {
    const newActive = !campaign.active;
    // Optimistic update
    if (onUpdateCampaign) onUpdateCampaign(campaign._id, { active: newActive });

    try {
      const res = await fetch(`${API_URL}/campaigns/${campaign._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: newActive })
      });
      const data = await res.json();
      if (data.success) {
        toast.success(newActive ? t('campaignTree.campaignActivated') : t('campaignTree.campaignDeactivated'));
      } else {
        // Revert on failure
        if (onUpdateCampaign) onUpdateCampaign(campaign._id, { active: campaign.active });
        toast.error(t('campaignTree.errorToggle'));
      }
    } catch (err) {
      // Revert on failure
      if (onUpdateCampaign) onUpdateCampaign(campaign._id, { active: campaign.active });
      console.error('Error toggling campaign:', err);
      toast.error(t('campaignTree.errorToggle'));
    }
  };

  // Wrap onAddChild to auto-expand the parent
  const handleAddChild = (item) => {
    // Expand the parent node
    setExpandedNodes(prev => {
      const newExpanded = new Set(prev);
      newExpanded.add(item._id);
      return newExpanded;
    });

    // Call the original onAddChild
    onAddChild(item);
  };

  // Filter campaigns by search query (matches ID, fbCampaignId, ref, or name)
  const filterCampaigns = (items, query) => {
    if (!query.trim()) return items;
    const lowerQuery = query.toLowerCase().trim();

    return items.filter(item => {
      const matchesItem =
        item._id?.toLowerCase().includes(lowerQuery) ||
        item.fbCampaignId?.toLowerCase().includes(lowerQuery) ||
        item.fbAdSetId?.toLowerCase().includes(lowerQuery) ||
        item.fbAdId?.toLowerCase().includes(lowerQuery) ||
        item.ref?.toLowerCase().includes(lowerQuery) ||
        item.name?.toLowerCase().includes(lowerQuery);

      // Also check children recursively
      const matchingChildren = item.children ? filterCampaigns(item.children, query) : [];

      if (matchesItem || matchingChildren.length > 0) {
        return true;
      }
      return false;
    }).map(item => ({
      ...item,
      children: item.children ? filterCampaigns(item.children, query) : []
    }));
  };

  const filteredCampaigns = filterCampaigns(campaigns || [], searchQuery);
  const activeCampaigns = filteredCampaigns.filter(c => c.active);
  const inactiveCampaigns = filteredCampaigns.filter(c => !c.active);

  const renderNodeList = (list) => (
    <div className="divide-y divide-gray-700/50">
      {list.map((campaign) => (
        <CampaignNode
          key={campaign._id}
          item={campaign}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddChild={handleAddChild}
          onDetails={onDetails}
          onToggleActive={handleToggleActive}
          level={0}
          expandedNodes={expandedNodes}
          onToggleExpand={handleToggleExpand}
          t={t}
        />
      ))}
    </div>
  );

  return (
    <div>
      {/* Header with Add Button */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">{t('campaignTree.mainTitle')}</h1>
          <p className="text-gray-400 mt-2">{t('campaignTree.mainSubtitle')}</p>
        </div>
        <button
          onClick={onAdd}
          className="px-6 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center space-x-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>{t('campaignTree.newCampaign')}</span>
        </button>
      </div>

      {/* Search Box */}
      <div className="mb-6">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('campaignTree.searchPlaceholderFull')}
            className="w-full px-4 py-3 pl-12 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <svg className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-white"
            >
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
          <p className="text-gray-400 mt-4">{t('campaignTree.loading')}</p>
        </div>
      ) : !filteredCampaigns || filteredCampaigns.length === 0 ? (
        <div className="p-12 text-center bg-gray-800/50 border border-gray-700/50 rounded-xl">
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-700/50 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {searchQuery ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              )}
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">
            {searchQuery ? t('campaignTree.noResults') : t('campaignTree.noCampaignsFound')}
          </h3>
          <p className="text-gray-400 mb-6">
            {searchQuery
              ? t('campaignTree.noMatchQuery', { query: searchQuery })
              : t('campaignTree.startAdding')
            }
          </p>
          {!searchQuery && (
            <button
              onClick={onAdd}
              className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors inline-flex items-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>{t('campaignTree.addCampaignBtn')}</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active Campaigns */}
          {activeCampaigns.length > 0 && (
            <div className="bg-gray-800/50 backdrop-blur-lg border border-green-500/20 rounded-xl overflow-hidden">
              <div className="px-6 py-3 border-b border-gray-700/50 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-green-400"></div>
                <h2 className="text-lg font-bold text-white">{t('campaignTree.activeCampaigns')}</h2>
                <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">
                  {activeCampaigns.length}
                </span>
              </div>
              {renderNodeList(activeCampaigns)}
            </div>
          )}

          {/* Inactive Campaigns */}
          {inactiveCampaigns.length > 0 && (
            <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl overflow-hidden">
              <div className="px-6 py-3 border-b border-gray-700/50 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-gray-500"></div>
                <h2 className="text-lg font-bold text-gray-400">{t('campaignTree.inactiveCampaigns')}</h2>
                <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">
                  {inactiveCampaigns.length}
                </span>
              </div>
              {renderNodeList(inactiveCampaigns)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default CampaignTreeView;
