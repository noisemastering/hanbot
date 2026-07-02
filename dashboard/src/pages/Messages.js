import React, { useEffect, useState, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import API from "../api";
import TrackedLinkGenerator from "../components/TrackedLinkGenerator";
import ManualSaleForm from "../components/ManualSaleForm";
import ConversationCommercePanel from "../components/ConversationCommercePanel";
import ConversationHandoffPanel from "../components/ConversationHandoffPanel";
import { useTranslation } from '../i18n';
import FeatureTip from '../components/FeatureTip';

const PRODUCT_LABELS = {
  malla_sombra_raschel: "Malla Raschel",
  malla_sombra: "Malla Confeccionada",
  rollo: "Rollo Raschel",
  borde_separador: "Borde Separador",
  groundcover: "Ground Cover",
  monofilamento: "Monofilamento",
  confeccionada: "Malla Confeccionada",
  default: "—",
  master_flow: "—",
  general: "—"
};

function friendlyProduct(value) {
  if (!value) return '—';
  if (PRODUCT_LABELS[value]) return PRODUCT_LABELS[value];
  // Convert snake_case to Title Case
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function Messages() {
  const { t, locale } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [quickActions, setQuickActions] = useState([]);
  const [filteredConversations, setFilteredConversations] = useState([]);
  const [conversationStatuses, setConversationStatuses] = useState({});
  const [loading, setLoading] = useState({});
  const [selectedPsid, setSelectedPsid] = useState(null);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [fullConversation, setFullConversation] = useState([]);
  const [dateFilter, setDateFilter] = useState('today');
  const [refreshing, setRefreshing] = useState(false);
  const [showLinkGenerator, setShowLinkGenerator] = useState(false);
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [pendingHandoffs, setPendingHandoffs] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalConversations, setTotalConversations] = useState(0);
  const [loadingFiltered, setLoadingFiltered] = useState(false);
  const [adFilter, setAdFilter] = useState('');
  const [availableAds, setAvailableAds] = useState([]);
  const [keywordFilter, setKeywordFilter] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [purchaseIntentFilter, setPurchaseIntentFilter] = useState('');
  const [productInterestFilter, setProductInterestFilter] = useState('');
  const [sharedProductFilter, setSharedProductFilter] = useState('');
  const [handoffFilter, setHandoffFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [psidFilter, setPsidFilter] = useState('');

  const quickActionPsidsRef = useRef([]);
  const currentPageRef = useRef(1);
  const dateFilterRef = useRef('today');
  const adFilterRef = useRef('');
  const keywordFilterRef = useRef('');
  const purchaseIntentFilterRef = useRef('');
  const productInterestFilterRef = useRef('');
  const sharedProductFilterRef = useRef('');
  const handoffFilterRef = useRef('');
  const stateFilterRef = useRef('');
  const psidFilterRef = useRef('');

  // Helper function to show message excerpt
  const getMessageExcerpt = (text, maxLength = 60) => {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  // Helper function to get channel icon and label
  const getChannelDisplay = (channel) => {
    if (channel === 'whatsapp') {
      return { icon: 'WA', label: 'WhatsApp', color: '#25D366', isText: true };
    }
    return { icon: 'FB', label: 'Facebook', color: '#1877F2', isText: true };
  };

  // Helper function to get purchase intent display
  // Default to medium (blue) if no score yet
  const getIntentDisplay = (intent) => {
    switch (intent) {
      case 'high':
        return { emoji: '🟢', color: '#4caf50', label: t('messages.intentHigh') };
      case 'low':
        return { emoji: '🔴', color: '#f44336', label: t('messages.intentLow') };
      case 'medium':
      default:
        return { emoji: '🔵', color: '#2196F3', label: t('messages.intentMedium') };
    }
  };

  // Helper function to format wait time
  const formatWaitTime = (minutes) => {
    if (minutes == null) return '';
    if (minutes < 60) return t('messages.agoMinutes', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('messages.agoHours', { count: hours });
    const days = Math.floor(hours / 24);
    return t('messages.agoDays', { count: days });
  };

  // Helper function to determine handoff priority and colors
  // Red = urgent (customer upset or bot broke), Yellow = action needed (quote/order), Green = informational
  const getHandoffStyle = (handoffReason) => {
    const r = (handoffReason || '').toLowerCase();

    // RED — Urgent: customer upset, bot broke, or explicit human request
    const isUrgent =
      r.includes('frustrad') ||
      r.includes('queja') ||
      r.includes('complaint') ||
      r.includes('solicitó hablar') ||
      r.includes('requested human') ||
      r.includes('agente') ||
      r.includes('repetición') ||
      r.includes('no pudo entender') ||
      r.includes('confundido por precio') ||
      (r.includes('precio') && r.includes('verificar'));

    if (isUrgent) {
      return {
        backgroundColor: '#4a1515',
        borderColor: '#ff5252',
        textColor: '#ff5252',
        icon: '🚨',
        label: t('messages.handoffUrgent')
      };
    }

    // GREEN — Informational: images, location, out of stock, low pressure
    const isInfo =
      r.includes('imagen') ||
      r.includes('image') ||
      r.includes('proporcionó ubicación') ||
      r.includes('reporta producto agotado') ||
      (r.includes('producto agotado') && !r.includes('verificar')) ||
      r.includes('impermeab');

    if (isInfo) {
      return {
        backgroundColor: '#0d3320',
        borderColor: '#4caf50',
        textColor: '#4caf50',
        icon: 'ℹ️',
        label: t('messages.handoffInfo')
      };
    }

    // YELLOW — Action needed: quotes, orders, wholesale, custom sizes (default)
    return {
      backgroundColor: '#3d2900',
      borderColor: '#ffb300',
      textColor: '#ffb300',
      icon: '💰',
      label: t('messages.handoffActionRequired')
    };
  };

  // Get date range based on filter using Mexico City timezone
  const getDateRange = (filter) => {
    const now = new Date();
    const mexicoOffset = -6 * 60; // CST is UTC-6
    const localOffset = now.getTimezoneOffset();
    const offsetDiff = mexicoOffset - localOffset;

    const toMexicoTime = (date) => {
      const adjusted = new Date(date.getTime() + offsetDiff * 60000);
      return adjusted;
    };

    const mexicoNow = toMexicoTime(now);
    const startOfDay = new Date(mexicoNow);
    startOfDay.setHours(0, 0, 0, 0);

    switch(filter) {
      case 'today':
        return { start: startOfDay, end: new Date(mexicoNow.getTime() + 24 * 60 * 60 * 1000) };
      case 'yesterday':
        const yesterday = new Date(startOfDay);
        yesterday.setDate(yesterday.getDate() - 1);
        return { start: yesterday, end: startOfDay };
      case 'week':
        const weekAgo = new Date(startOfDay);
        weekAgo.setDate(weekAgo.getDate() - 7);
        return { start: weekAgo, end: new Date(mexicoNow.getTime() + 24 * 60 * 60 * 1000) };
      case 'month':
        const monthAgo = new Date(startOfDay);
        monthAgo.setDate(monthAgo.getDate() - 30);
        return { start: monthAgo, end: new Date(mexicoNow.getTime() + 24 * 60 * 60 * 1000) };
      case 'all':
      default:
        return { start: new Date(0), end: new Date(8640000000000000) }; // Max date
    }
  };

  // Build statuses map from grouped API conversations
  const applyStatusesFromGrouped = (conversations) => {
    const statuses = {};
    conversations.forEach(conv => {
      statuses[conv.psid] = {
        humanActive: conv.humanActive,
        handoffRequested: conv.handoffRequested,
        handoffReason: conv.handoffReason,
        purchaseIntent: conv.purchaseIntent,
        state: conv.state
      };
    });
    setConversationStatuses(prev => ({ ...prev, ...statuses }));
  };

  const fetchFullConversation = async (psid) => {
    try {
      const res = await API.get(`/conversations/${psid}`);
      // Reverse to show oldest first (chronological order, like a chat)
      setFullConversation([...res.data].reverse());
    } catch (err) {
      console.error("Error fetching full conversation:", err);
    }
  };

  const fetchPendingHandoffs = async () => {
    try {
      const res = await API.get("/conversations/pending-handoffs");
      setPendingHandoffs(res.data.data || []);
    } catch (err) {
      console.error("Error fetching pending handoffs:", err);
    }
  };

  const fetchQuickActions = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '10' });
      if (adFilterRef.current) params.set('adId', adFilterRef.current);
      const res = await API.get(`/conversations/grouped?${params}`);
      const convs = res.data.conversations || [];
      setQuickActions(convs);
      applyStatusesFromGrouped(convs);
      const psids = convs.map(c => c.psid);
      quickActionPsidsRef.current = psids;
      return psids;
    } catch (err) {
      console.error("Error fetching quick actions:", err);
      return quickActionPsidsRef.current;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchFilteredPage = useCallback(async (page = 1, excludePsids = null) => {
    setLoadingFiltered(true);
    try {
      const { start, end } = getDateRange(dateFilterRef.current);
      const exclude = excludePsids || quickActionPsidsRef.current;
      const params = new URLSearchParams({
        page: String(page),
        limit: '20'
      });
      // When keyword OR PSID search is active, search across ALL dates and
      // don't exclude recent PSIDs — the user wants to find a specific convo
      // regardless of when it happened or whether it's also in Quick Actions.
      const searchActive = !!keywordFilterRef.current || !!psidFilterRef.current;
      if (!searchActive) {
        params.set('start', start.toISOString());
        params.set('end', end.toISOString());
        if (exclude.length > 0) {
          params.set('excludePsids', exclude.join(','));
        }
      }
      if (adFilterRef.current) params.set('adId', adFilterRef.current);
      if (keywordFilterRef.current) params.set('keyword', keywordFilterRef.current);
      if (purchaseIntentFilterRef.current) params.set('purchaseIntent', purchaseIntentFilterRef.current);
      if (productInterestFilterRef.current) params.set('productInterest', productInterestFilterRef.current);
      if (sharedProductFilterRef.current) params.set('sharedProduct', sharedProductFilterRef.current);
      if (handoffFilterRef.current) params.set('handoff', handoffFilterRef.current);
      if (stateFilterRef.current) params.set('state', stateFilterRef.current);
      if (psidFilterRef.current) params.set('psid', psidFilterRef.current);
      const res = await API.get(`/conversations/grouped?${params}`);
      const convs = res.data.conversations || [];
      setFilteredConversations(convs);
      setCurrentPage(res.data.pagination.page);
      setTotalPages(res.data.pagination.pages);
      setTotalConversations(res.data.pagination.total);
      currentPageRef.current = res.data.pagination.page;
      applyStatusesFromGrouped(convs);
    } catch (err) {
      console.error("Error fetching filtered conversations:", err);
    } finally {
      setLoadingFiltered(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAvailableAds = useCallback(async () => {
    try {
      const res = await API.get('/conversations/ads');
      setAvailableAds(res.data.ads || []);
    } catch (err) {
      console.error("Error fetching available ads:", err);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      // Fetch quick actions + pending handoffs + available ads in parallel
      const [excludePsids] = await Promise.all([
        fetchQuickActions(),
        fetchPendingHandoffs(),
        fetchAvailableAds()
      ]);
      setInitialLoading(false);
      // Then fetch filtered page (needs exclude list)
      await fetchFilteredPage(1, excludePsids);
    };
    init();

    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      fetchQuickActions();
      fetchFilteredPage(currentPageRef.current);
      fetchPendingHandoffs();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchQuickActions, fetchFilteredPage, fetchAvailableAds]);

  // Refetch both sections when ad filter changes
  useEffect(() => {
    adFilterRef.current = adFilter;
    fetchQuickActions().then(excludePsids => fetchFilteredPage(1, excludePsids));
  }, [adFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch filtered page when date filter changes
  useEffect(() => {
    dateFilterRef.current = dateFilter;
    if (!initialLoading) {
      setCurrentPage(1);
      currentPageRef.current = 1;
      fetchFilteredPage(1);
    }
  }, [dateFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep link: ?psid=… opens that specific conversation in the chat modal
  // (e.g. when arriving from a ticket). After firing once we strip the
  // param from the URL so reloads don't keep re-opening the modal.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const incomingPsid = params.get('psid');
    if (!incomingPsid) return;
    if (incomingPsid === selectedPsid) return;

    // Strip ?psid= from the URL immediately — keeps reloads clean even if
    // the resolve below takes a few hundred ms. Use window.history directly
    // so the address bar update happens BEFORE any React state change can
    // cause a re-render.
    params.delete('psid');
    const cleanedSearch = params.toString();
    const newUrl = `${location.pathname}${cleanedSearch ? '?' + cleanedSearch : ''}`;
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState(null, '', newUrl);
    }
    // Belt-and-suspenders: also let React Router know
    try { navigate(newUrl, { replace: true }); } catch {}

    (async () => {
      try {
        // Resolve channel from the conversation doc, then open the modal
        const res = await API.get('/conversations/grouped?limit=1&psid=' + encodeURIComponent(incomingPsid));
        const match = res.data?.conversations?.find(c => c.psid === incomingPsid) || res.data?.conversations?.[0];
        const channel = match?.channel || (incomingPsid.startsWith('wa:') ? 'whatsapp' : 'facebook');
        setSelectedPsid(incomingPsid);
        setSelectedChannel(channel);
        fetchFullConversation(incomingPsid);
      } catch (err) {
        console.error('Failed to open conversation from deep link:', err);
        // Fall back to filter mode so the user can still find it manually
        setPsidFilter(incomingPsid);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // Refetch when content filters change
  useEffect(() => {
    keywordFilterRef.current = keywordFilter;
    purchaseIntentFilterRef.current = purchaseIntentFilter;
    productInterestFilterRef.current = productInterestFilter;
    sharedProductFilterRef.current = sharedProductFilter;
    handoffFilterRef.current = handoffFilter;
    stateFilterRef.current = stateFilter;
    psidFilterRef.current = psidFilter;
    if (!initialLoading) {
      setCurrentPage(1);
      currentPageRef.current = 1;
      fetchFilteredPage(1);
    }
  }, [keywordFilter, purchaseIntentFilter, productInterestFilter, sharedProductFilter, handoffFilter, stateFilter, psidFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTakeover = async (psid) => {
    setLoading(prev => ({ ...prev, [psid]: true }));
    try {
      await API.post(`/api/conversation/${psid}/takeover`, {
        agentName: "Dashboard User",
        reason: "Manual takeover from dashboard"
      });

      // Refresh status
      const statusRes = await API.get(`/api/conversation/${psid}/status`);
      setConversationStatuses(prev => ({
        ...prev,
        [psid]: statusRes.data
      }));

      alert(t('alert.takeoverSuccess', { psid }));
    } catch (err) {
      console.error("Error taking over:", err);
      alert(`❌ Error: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(prev => ({ ...prev, [psid]: false }));
    }
  };

  const handleResolveHandoff = async (psid) => {
    try {
      await API.post(`/conversations/${psid}/resolve-handoff`);
      setPendingHandoffs(prev => prev.filter(h => h.psid !== psid));
    } catch (err) {
      console.error("Error resolving handoff:", err);
    }
  };

  const handleTakeoverAndResolve = async (psid) => {
    await handleTakeover(psid);
    await handleResolveHandoff(psid);
  };

  const handleRelease = async (psid) => {
    setLoading(prev => ({ ...prev, [psid]: true }));
    try {
      await API.post(`/api/conversation/${psid}/release`);

      // Refresh status
      const statusRes = await API.get(`/api/conversation/${psid}/status`);
      setConversationStatuses(prev => ({
        ...prev,
        [psid]: statusRes.data
      }));

      alert(t('alert.releaseSuccess', { psid }));
    } catch (err) {
      console.error("Error releasing:", err);
      alert(`❌ Error: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(prev => ({ ...prev, [psid]: false }));
    }
  };

  // Resume bot — re-process customer's last message through the AI pipeline
  const [resumingBot, setResumingBot] = useState(false);
  const handleResumeBot = async (psid) => {
    setResumingBot(true);
    try {
      const response = await API.post(`/conversations/${psid}/resume-bot`);
      if (response.data.success && response.data.responded) {
        // Add bot response to the conversation view
        setFullConversation(prev => [...prev, {
          text: response.data.text,
          senderType: 'bot',
          timestamp: new Date().toISOString()
        }]);
        // Update status to show bot is active
        setConversationStatuses(prev => ({
          ...prev,
          [psid]: { ...prev[psid], humanActive: false }
        }));
      } else {
        alert(response.data.reason || t('messages.noResponse'));
      }
    } catch (err) {
      console.error("Error resuming bot:", err);
      alert(`Error: ${err.response?.data?.error || err.message}`);
    } finally {
      setResumingBot(false);
    }
  };

  // Gallery state
  const [showGallery, setShowGallery] = useState(false);
  const [galleryItems, setGalleryItems] = useState([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryFilter, setGalleryFilter] = useState('all'); // 'all' | 'image' | 'pdf'

  const fetchGallery = async () => {
    setGalleryLoading(true);
    try {
      const res = await API.get('/conversations/attachments/gallery');
      setGalleryItems(res.data.items || []);
    } catch (err) {
      console.error('Error loading gallery:', err);
    } finally {
      setGalleryLoading(false);
    }
  };

  const openGallery = () => {
    setShowGallery(true);
    fetchGallery();
  };

  const handleSendFromGallery = async (item) => {
    if (!selectedPsid) return;
    setSendingReply(true);
    setShowGallery(false);
    try {
      const response = await API.post('/conversations/reply-from-url', {
        psid: selectedPsid,
        url: item.url,
        filename: item.filename,
        type: item.type,
        caption: replyText.trim() || undefined
      });
      if (response.data.success) {
        const caption = replyText.trim();
        const label = item.type === 'image' ? 'Imagen' : 'PDF';
        const text = caption ? `[${label}: ${item.url}] ${caption}` : `[${label}: ${item.url}]`;
        setFullConversation(prev => [...prev, { text, senderType: 'human', timestamp: new Date().toISOString() }]);
        setReplyText('');
        setConversationStatuses(prev => ({
          ...prev,
          [selectedPsid]: { ...prev[selectedPsid], humanActive: true }
        }));
      }
    } catch (err) {
      alert(`Error al enviar: ${err.response?.data?.error || err.message}`);
    } finally {
      setSendingReply(false);
    }
  };

  // Send attachment (image or PDF) to user
  const handleSendAttachment = async (file) => {
    if (!file || !selectedPsid) return;

    setSendingReply(true);
    try {
      const formData = new FormData();
      formData.append('psid', selectedPsid);
      formData.append('file', file);
      if (replyText.trim()) {
        formData.append('caption', replyText.trim());
      }

      const response = await API.post('/conversations/reply-attachment', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (response.data.success) {
        const isImage = file.type.startsWith('image/');
        const caption = replyText.trim();
        const text = caption
          ? `[${isImage ? 'Imagen' : 'PDF'}: ${response.data.url}] ${caption}`
          : `[${isImage ? 'Imagen' : 'PDF'}: ${response.data.url}]`;

        setFullConversation(prev => [...prev, {
          text,
          senderType: 'human',
          timestamp: new Date().toISOString()
        }]);

        setReplyText('');
        setConversationStatuses(prev => ({
          ...prev,
          [selectedPsid]: { ...prev[selectedPsid], humanActive: true }
        }));
      }
    } catch (err) {
      console.error("Error sending attachment:", err);
      alert(`Error al enviar archivo: ${err.response?.data?.error || err.message}`);
    } finally {
      setSendingReply(false);
    }
  };

  // Send reply to user (works for both Messenger and WhatsApp)
  const handleSendReply = async () => {
    if (!replyText.trim() || !selectedPsid) return;

    setSendingReply(true);
    try {
      const response = await API.post('/conversations/reply', {
        psid: selectedPsid,
        text: replyText.trim()
      });

      if (response.data.success) {
        // Add the sent message to the conversation
        setFullConversation(prev => [...prev, {
          text: replyText.trim(),
          senderType: 'human',
          timestamp: new Date().toISOString()
        }]);

        // Clear the input
        setReplyText('');

        // Update status to show human is active
        setConversationStatuses(prev => ({
          ...prev,
          [selectedPsid]: { ...prev[selectedPsid], humanActive: true }
        }));
      }
    } catch (err) {
      console.error("Error sending reply:", err);
      alert(`${t('messages.errorSending')}: ${err.response?.data?.error || err.message}`);
    } finally {
      setSendingReply(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        fetchQuickActions(),
        fetchFilteredPage(currentPageRef.current),
        fetchPendingHandoffs()
      ]);
    } catch (err) {
      console.error("Refresh error:", err);
      alert(`Error: ${err.response?.data?.error || err.message}`);
    } finally {
      setRefreshing(false);
    }
  };

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > totalPages) return;
    setCurrentPage(newPage);
    currentPageRef.current = newPage;
    fetchFilteredPage(newPage);
  };

  // Count conversations needing help (from filtered list)
  const conversationsNeedingHelp = filteredConversations.filter(msg => {
    const status = conversationStatuses[msg.psid];
    return status?.handoffRequested && !status?.humanActive;
  }).length;

  if (initialLoading) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "40vh",
        gap: "1rem"
      }}>
        <div style={{
          width: "40px",
          height: "40px",
          border: "4px solid rgba(255,255,255,0.1)",
          borderTopColor: "#4caf50",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite"
        }} />
        <p style={{ color: "#888", fontSize: "1rem" }}>{t('messages.loadingConversations')}</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Gallery modal
  const galleryModal = showGallery && (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}
      onClick={() => setShowGallery(false)}>
      <div onClick={e => e.stopPropagation()} style={{ backgroundColor: '#1a1a1a', borderRadius: '12px', border: '1px solid #2a2a2a', maxWidth: '900px', width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #2a2a2a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ color: 'white', margin: 0, fontSize: '1.1rem' }}>📁 Galería de archivos</h3>
            <p style={{ color: '#888', margin: '4px 0 0', fontSize: '0.8rem' }}>Reutiliza un archivo o sube uno nuevo</p>
          </div>
          <button onClick={() => setShowGallery(false)} style={{ background: 'none', border: 'none', color: '#888', fontSize: '1.5rem', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Filter + Upload row */}
        <div style={{ padding: '0.75rem 1.5rem', borderBottom: '1px solid #2a2a2a', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {['all', 'image', 'pdf'].map(f => (
              <button key={f} onClick={() => setGalleryFilter(f)}
                style={{ padding: '0.4rem 0.8rem', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '0.85rem',
                  backgroundColor: galleryFilter === f ? '#7c4dff' : '#2a2a2a', color: 'white' }}>
                {f === 'all' ? 'Todos' : f === 'image' ? 'Imágenes' : 'PDFs'}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={() => { setShowGallery(false); document.getElementById('attachment-input').click(); }}
            style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '0.85rem', backgroundColor: '#4caf50', color: 'white', fontWeight: 600 }}>
            ⬆️ Subir nuevo
          </button>
        </div>

        {/* Gallery grid */}
        <div style={{ flex: 1, overflow: 'auto', padding: '1rem 1.5rem' }}>
          {galleryLoading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#888' }}>Cargando galería…</div>
          ) : galleryItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#888' }}>No hay archivos subidos aún. Sube uno para empezar.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem' }}>
              {galleryItems
                .filter(i => galleryFilter === 'all' || i.type === galleryFilter)
                .map((item, idx) => (
                <div key={idx} onClick={() => handleSendFromGallery(item)}
                  style={{ cursor: 'pointer', backgroundColor: '#222', borderRadius: '8px', overflow: 'hidden', border: '1px solid #333', transition: 'border-color 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#7c4dff'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = '#333'}>
                  {item.type === 'image' ? (
                    <img src={item.url} alt={item.filename} style={{ width: '100%', height: '110px', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ height: '110px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3rem', backgroundColor: '#2a2a2a' }}>📄</div>
                  )}
                  <div style={{ padding: '0.4rem 0.5rem', fontSize: '0.7rem', color: '#ccc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.filename}
                  </div>
                  <div style={{ padding: '0 0.5rem 0.4rem', fontSize: '0.65rem', color: '#666' }}>
                    {item.folder.replace('hanlob/', '')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {replyText.trim() && (
          <div style={{ padding: '0.5rem 1.5rem', borderTop: '1px solid #2a2a2a', backgroundColor: '#0f0f0f', fontSize: '0.8rem', color: '#888' }}>
            💬 Se enviará con el caption: <span style={{ color: '#ccc' }}>"{replyText.trim()}"</span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div>
      {galleryModal}
      {/* Refresh Button */}
      <div style={{ marginBottom: "1.5rem", display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            padding: "0.75rem 1.5rem",
            backgroundColor: refreshing ? "#666" : "#4caf50",
            color: "white",
            border: "none",
            borderRadius: "8px",
            cursor: refreshing ? "not-allowed" : "pointer",
            fontWeight: "bold",
            fontSize: "1rem",
            opacity: refreshing ? 0.6 : 1
          }}
        >
          {refreshing ? `🔄 ${t('messages.refreshing')}` : `🔄 ${t('messages.refresh')}`}
        </button>
      </div>

      {/* SECTION 0: Pending Handoffs */}
      {pendingHandoffs.length > 0 && (
        <div style={{ marginBottom: "2.5rem" }}>
          <div style={{
            backgroundColor: "#5c3d00",
            padding: "12px 16px",
            borderRadius: "8px 8px 0 0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}>
            <h2 style={{ color: "#ffb300", margin: 0, fontSize: "1.3rem", fontWeight: "bold" }}>
              {t('messages.pendingAttention')} - {pendingHandoffs.length}
            </h2>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #555" }}>
            <thead>
              <tr style={{ backgroundColor: "#3d2900", color: "#ffb300" }}>
                <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.channel')}</th>
                <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.user')}</th>
                <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.waitingSince')}</th>
                <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.reason')}</th>
                <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.product')}</th>
                <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.city')}</th>
                <th style={{ padding: "10px", textAlign: "center", borderBottom: "2px solid #555" }}>{t('messages.intent')}</th>
                <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.action')}</th>
              </tr>
            </thead>
            <tbody>
              {pendingHandoffs.map((handoff) => {
                const channelDisplay = getChannelDisplay(handoff.channel);
                const intentDisplay = getIntentDisplay(handoff.purchaseIntent);
                const handoffStyle = getHandoffStyle(handoff.handoffReason);
                return (
                  <tr
                    key={handoff.psid}
                    onClick={() => {
                      setSelectedPsid(handoff.psid);
                      setSelectedChannel(handoff.channel);
                      fetchFullConversation(handoff.psid);
                      // Opening a pending conversation means the human is taking over —
                      // mark it taken (same as the "Tomar" button), not just viewed.
                      handleTakeoverAndResolve(handoff.psid);
                    }}
                    style={{
                      borderBottom: "1px solid #555",
                      cursor: "pointer",
                      borderLeft: `4px solid ${handoffStyle.borderColor}`,
                      backgroundColor: handoffStyle.backgroundColor
                    }}
                  >
                    <td style={{ padding: "10px", textAlign: "center" }}>
                      <span
                        style={{
                          backgroundColor: channelDisplay.color,
                          color: 'white',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 'bold'
                        }}
                        title={channelDisplay.label}
                      >
                        {channelDisplay.icon}
                      </span>
                    </td>
                    <td style={{ padding: "10px", color: "#e0e0e0", fontSize: "0.85rem" }}>
                      {handoff.channel === 'whatsapp' && handoff.psid?.startsWith('wa:') ? (
                        <span
                          style={{ cursor: 'pointer' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(handoff.psid.substring(3));
                            alert(t('messages.numberCopied', { number: handoff.psid.substring(3) }));
                          }}
                          title="Click para copiar"
                        >
                          {handoff.psid.substring(3)}
                        </span>
                      ) : (
                        <span style={{ color: '#888' }}>{handoff.psid?.substring(0, 10)}...</span>
                      )}
                    </td>
                    <td style={{ padding: "10px", color: "#e0e0e0", fontSize: "0.85rem" }}>
                      <div>
                        {handoff.handoffTimestamp ? new Date(handoff.handoffTimestamp).toLocaleString(locale, {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        }) : '—'}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "#ffb300" }}>
                        {formatWaitTime(handoff.waitTimeMinutes)}
                      </div>
                      {handoff.isAfterHours && (
                        <span style={{
                          display: "inline-block",
                          marginTop: "4px",
                          backgroundColor: "#ff9800",
                          color: "#000",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          fontSize: "0.65rem",
                          fontWeight: "bold"
                        }}>
                          {t('messages.afterHours')}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "10px", fontSize: "0.85rem", maxWidth: "220px" }}>
                      <div style={{ color: handoffStyle.textColor, fontWeight: "bold", fontSize: "0.8rem", marginBottom: "2px" }}>
                        {handoffStyle.icon} {handoffStyle.label}
                      </div>
                      <div style={{ color: "#aaa", fontSize: "0.75rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {getMessageExcerpt(handoff.handoffReason, 40) || '—'}
                      </div>
                    </td>
                    <td style={{ padding: "10px", color: "#e0e0e0", fontSize: "0.85rem" }}>
                      {friendlyProduct(handoff.productInterest || handoff.currentFlow)}
                    </td>
                    <td style={{ padding: "10px", color: "#e0e0e0", fontSize: "0.85rem" }}>
                      {[handoff.city, handoff.stateMx].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td style={{ padding: "10px", textAlign: "center" }}>
                      <span title={intentDisplay.label} style={{ fontSize: "1.2rem" }}>
                        {intentDisplay.emoji}
                      </span>
                    </td>
                    <td style={{ padding: "10px" }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTakeoverAndResolve(handoff.psid);
                        }}
                        disabled={loading[handoff.psid]}
                        style={{
                          padding: "6px 12px",
                          backgroundColor: "#ff9800",
                          color: "white",
                          border: "none",
                          borderRadius: "8px",
                          cursor: loading[handoff.psid] ? "not-allowed" : "pointer",
                          opacity: loading[handoff.psid] ? 0.6 : 1,
                          fontSize: "0.85rem",
                          fontWeight: "bold"
                        }}
                      >
                        {loading[handoff.psid] ? "..." : t('messages.take')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Dedicated Content Search Tool */}
      <div style={{
        marginBottom: "1.5rem",
        padding: "1rem",
        backgroundColor: "rgba(16, 185, 129, 0.05)",
        border: keywordFilter ? "2px solid #10b981" : "1px solid #374151",
        borderRadius: "12px"
      }}>
        <label style={{ color: "#9ca3af", fontSize: "0.85rem", display: "block", marginBottom: "0.5rem" }}>
          🔍 Buscar en el contenido o por ID/teléfono del cliente
        </label>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
          {(() => {
            // Heuristic: if the input is a single token of mostly digits (or wa: prefix),
            // we treat it as a USER ID lookup rather than a content search.
            const trimmed = keywordInput.trim();
            const looksLikeId = trimmed && /^(wa:)?[\d\s+\-()]{6,}$/.test(trimmed) && !/[a-z]{2}/i.test(trimmed.replace(/^wa:/i, ''));
            const submit = () => {
              if (looksLikeId) {
                setPsidFilter(trimmed.replace(/^wa:/i, '').replace(/[^0-9]/g, '') ? trimmed : trimmed);
                setKeywordFilter(''); // clear content search so it doesn't fight
              } else {
                setKeywordFilter(trimmed);
                setPsidFilter('');
              }
            };
            return (
              <>
                <textarea
                  placeholder='Ej: "cuánto cuesta una de 5x4" (contenido) o "26625314740484739" / "wa:524425957432" (ID o teléfono)'
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  rows={2}
                  style={{
                    flex: 1,
                    padding: "0.6rem 0.8rem",
                    backgroundColor: "rgba(255, 255, 255, 0.08)",
                    color: "white",
                    border: looksLikeId ? "2px solid #7c4dff" : "1px solid #555",
                    borderRadius: "8px",
                    fontSize: "0.95rem",
                    resize: "vertical",
                    fontFamily: "inherit"
                  }}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <button
                    onClick={submit}
                    disabled={!trimmed || (looksLikeId ? trimmed === psidFilter : trimmed === keywordFilter)}
              style={{
                    padding: "0.5rem 1.2rem",
                    backgroundColor: (!trimmed || (looksLikeId ? trimmed === psidFilter : trimmed === keywordFilter)) ? "#374151" : (looksLikeId ? "#7c4dff" : "#10b981"),
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    cursor: (!trimmed || (looksLikeId ? trimmed === psidFilter : trimmed === keywordFilter)) ? "not-allowed" : "pointer",
                    fontSize: "0.9rem",
                    fontWeight: "bold",
                    flex: 1,
                    minWidth: "100px"
                  }}>
                  {looksLikeId ? '🆔 Buscar' : 'Buscar'}
                </button>
                {(keywordFilter || psidFilter) && (
                  <button onClick={() => { setKeywordInput(''); setKeywordFilter(''); setPsidFilter(''); }}
                    style={{ padding: "0.4rem 1rem", backgroundColor: "#7f1d1d", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "0.85rem" }}>
                    Limpiar
                  </button>
                )}
              </div>
            </>
            );
          })()}
        </div>
        {keywordFilter && (
          <p style={{ color: "#10b981", fontSize: "0.8rem", marginTop: "0.5rem", marginBottom: 0 }}>
            Filtrando por contenido: <strong>{keywordFilter}</strong> ({keywordFilter.split(/\s+/).filter(w => w.length >= 2).length} palabras, todas deben aparecer en la convo)
          </p>
        )}
        {psidFilter && (
          <p style={{ color: "#a78bfa", fontSize: "0.8rem", marginTop: "0.5rem", marginBottom: 0 }}>
            Filtrando por ID/teléfono: <strong>{psidFilter}</strong>
          </p>
        )}
      </div>

      {/* Constraint filters bar */}
      <div style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ color: "#6b7280", fontSize: "0.8rem", marginRight: "0.25rem" }}>Filtros adicionales:</span>

        {/* PSID / phone search */}
        <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
          <input
            type="text"
            placeholder="ID o teléfono…"
            value={psidFilter}
            onChange={(e) => setPsidFilter(e.target.value.trim())}
            title="Busca por PSID de Messenger o número de WhatsApp (con o sin prefijo wa:)"
            style={{
              padding: "0.5rem 0.75rem",
              backgroundColor: psidFilter ? "rgba(124, 77, 255, 0.15)" : "rgba(255, 255, 255, 0.1)",
              color: "white",
              border: psidFilter ? "2px solid #7c4dff" : "1px solid #555",
              borderRadius: "8px",
              fontSize: "0.85rem",
              width: "180px"
            }}
          />
          {psidFilter && (
            <button onClick={() => setPsidFilter('')}
              style={{ padding: "0.4rem 0.6rem", backgroundColor: "rgba(255,255,255,0.05)", color: "#aaa", border: "1px solid #555", borderRadius: "8px", cursor: "pointer", fontSize: "0.85rem" }}
              title="Limpiar">✕</button>
          )}
        </div>

        {/* Ad filter */}
        <select value={adFilter} onChange={(e) => setAdFilter(e.target.value)}
          style={{
            padding: "0.5rem 0.75rem",
            backgroundColor: adFilter ? "#7c4dff" : "rgba(255, 255, 255, 0.1)",
            color: "white", border: adFilter ? "2px solid #7c4dff" : "1px solid #555",
            borderRadius: "8px", cursor: "pointer", fontSize: "0.9rem", maxWidth: "200px"
          }}>
          <option value="" style={{ backgroundColor: "#1a1a1a" }}>{t('messages.allAds')}</option>
          {availableAds.map(ad => (
            <option key={ad.adId} value={ad.adId} style={{ backgroundColor: "#1a1a1a" }}>{ad.name}</option>
          ))}
        </select>

        {/* Purchase intent */}
        <select value={purchaseIntentFilter} onChange={(e) => setPurchaseIntentFilter(e.target.value)}
          style={{
            padding: "0.5rem 0.75rem",
            backgroundColor: purchaseIntentFilter ? "#3b82f6" : "rgba(255, 255, 255, 0.1)",
            color: "white", border: purchaseIntentFilter ? "2px solid #3b82f6" : "1px solid #555",
            borderRadius: "8px", cursor: "pointer", fontSize: "0.9rem"
          }}>
          <option value="" style={{ backgroundColor: "#1a1a1a" }}>Intención: todas</option>
          <option value="high" style={{ backgroundColor: "#1a1a1a" }}>Alta</option>
          <option value="medium" style={{ backgroundColor: "#1a1a1a" }}>Media</option>
          <option value="low" style={{ backgroundColor: "#1a1a1a" }}>Baja</option>
        </select>

        {/* Product interest */}
        <select value={productInterestFilter} onChange={(e) => setProductInterestFilter(e.target.value)}
          style={{
            padding: "0.5rem 0.75rem",
            backgroundColor: productInterestFilter ? "#f59e0b" : "rgba(255, 255, 255, 0.1)",
            color: "white", border: productInterestFilter ? "2px solid #f59e0b" : "1px solid #555",
            borderRadius: "8px", cursor: "pointer", fontSize: "0.9rem"
          }}>
          <option value="" style={{ backgroundColor: "#1a1a1a" }}>Producto: todos</option>
          <option value="malla_sombra" style={{ backgroundColor: "#1a1a1a" }}>Malla sombra</option>
          <option value="borde_separador" style={{ backgroundColor: "#1a1a1a" }}>Borde separador</option>
          <option value="rollo" style={{ backgroundColor: "#1a1a1a" }}>Rollo</option>
          <option value="ground_cover" style={{ backgroundColor: "#1a1a1a" }}>Ground cover</option>
          <option value="confeccionada" style={{ backgroundColor: "#1a1a1a" }}>Confeccionada</option>
        </select>

        {/* Shared product */}
        <select value={sharedProductFilter} onChange={(e) => setSharedProductFilter(e.target.value)}
          style={{
            padding: "0.5rem 0.75rem",
            backgroundColor: sharedProductFilter ? "#06b6d4" : "rgba(255, 255, 255, 0.1)",
            color: "white", border: sharedProductFilter ? "2px solid #06b6d4" : "1px solid #555",
            borderRadius: "8px", cursor: "pointer", fontSize: "0.9rem"
          }}>
          <option value="" style={{ backgroundColor: "#1a1a1a" }}>Link compartido: todos</option>
          <option value="yes" style={{ backgroundColor: "#1a1a1a" }}>Sí compartió</option>
          <option value="no" style={{ backgroundColor: "#1a1a1a" }}>No compartió</option>
        </select>

        {/* Handoff */}
        <select value={handoffFilter} onChange={(e) => setHandoffFilter(e.target.value)}
          style={{
            padding: "0.5rem 0.75rem",
            backgroundColor: handoffFilter ? "#ef4444" : "rgba(255, 255, 255, 0.1)",
            color: "white", border: handoffFilter ? "2px solid #ef4444" : "1px solid #555",
            borderRadius: "8px", cursor: "pointer", fontSize: "0.9rem"
          }}>
          <option value="" style={{ backgroundColor: "#1a1a1a" }}>Handoff: todos</option>
          <option value="yes" style={{ backgroundColor: "#1a1a1a" }}>Pidió humano</option>
          <option value="no" style={{ backgroundColor: "#1a1a1a" }}>No pidió</option>
        </select>

        {/* State */}
        <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}
          style={{
            padding: "0.5rem 0.75rem",
            backgroundColor: stateFilter ? "#8b5cf6" : "rgba(255, 255, 255, 0.1)",
            color: "white", border: stateFilter ? "2px solid #8b5cf6" : "1px solid #555",
            borderRadius: "8px", cursor: "pointer", fontSize: "0.9rem"
          }}>
          <option value="" style={{ backgroundColor: "#1a1a1a" }}>Estado: todos</option>
          <option value="new" style={{ backgroundColor: "#1a1a1a" }}>Nueva</option>
          <option value="active" style={{ backgroundColor: "#1a1a1a" }}>Activa</option>
          <option value="closed" style={{ backgroundColor: "#1a1a1a" }}>Cerrada</option>
          <option value="needs_human" style={{ backgroundColor: "#1a1a1a" }}>Necesita humano</option>
          <option value="human_handling" style={{ backgroundColor: "#1a1a1a" }}>En humano</option>
        </select>

        {/* Clear all (only the dropdown filters, not keyword) */}
        {(adFilter || purchaseIntentFilter || productInterestFilter || sharedProductFilter || handoffFilter || stateFilter) && (
          <button onClick={() => {
            setAdFilter('');
            setPurchaseIntentFilter(''); setProductInterestFilter('');
            setSharedProductFilter(''); setHandoffFilter(''); setStateFilter('');
          }} style={{ padding: "0.5rem 0.75rem", backgroundColor: "#374151", color: "white", border: "1px solid #555", borderRadius: "8px", cursor: "pointer", fontSize: "0.85rem" }}>
            Limpiar
          </button>
        )}
      </div>

      {/* SECTION 1: Recent Activity Table — hidden when a search filter is active */}
      {!keywordFilter && !psidFilter && <div style={{ marginBottom: "2.5rem" }}>
        <h2 style={{ color: "white", marginBottom: "1rem", fontSize: "1.3rem", fontWeight: "bold" }}>
          ⚡ {t('messages.recentActivity')}
        </h2>
        <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #555" }}>
          <thead>
            <tr style={{ backgroundColor: "#2a1a5e", color: "#bb86fc" }}>
              <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.channel')}</th>
              <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.user')}</th>
              <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.date')}</th>
              <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.lastMessageCol')}</th>
              <th style={{ padding: "10px", textAlign: "center", borderBottom: "2px solid #555" }}>{t('messages.intent')}</th>
              <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.spokesperson')}</th>
              <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.action')}</th>
            </tr>
          </thead>
          <tbody>
            {quickActions.map((msg) => {
              const status = conversationStatuses[msg.psid];
              const isHumanActive = status?.humanActive;
              const needsHelp = status?.handoffRequested && !isHumanActive;
              const channelDisplay = getChannelDisplay(msg.channel);
              const handoffStyle = needsHelp ? getHandoffStyle(status?.handoffReason) : null;

              return (
                <tr
                  key={msg.psid}
                  onClick={() => {
                    setSelectedPsid(msg.psid);
                    setSelectedChannel(msg.channel);
                    fetchFullConversation(msg.psid);
                  }}
                  style={{
                    borderBottom: "1px solid #555",
                    cursor: "pointer",
                    backgroundColor: handoffStyle ? handoffStyle.backgroundColor : "transparent",
                    borderLeft: handoffStyle ? `4px solid ${handoffStyle.borderColor}` : "none"
                  }}
                >
                  <td style={{ padding: "10px", textAlign: "center" }}>
                    <span
                      style={{
                        backgroundColor: channelDisplay.color,
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 'bold'
                      }}
                      title={channelDisplay.label}
                    >
                      {channelDisplay.icon}
                    </span>
                  </td>
                  <td style={{ padding: "10px", color: "#e0e0e0", fontSize: "0.85rem" }}>
                    {msg.channel === 'whatsapp' && msg.psid?.startsWith('wa:') ? (
                      <span
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(msg.psid.substring(3));
                          alert(t('messages.numberCopied', { number: msg.psid.substring(3) }));
                        }}
                        title="Click para copiar"
                      >
                        📱 {msg.psid.substring(3)}
                      </span>
                    ) : (
                      <span style={{ color: '#888' }}>{msg.psid?.substring(0, 10)}...</span>
                    )}
                  </td>
                  <td style={{ padding: "10px", color: "#e0e0e0", fontSize: "0.9rem" }}>
                    {new Date(msg.lastMessageAt).toLocaleString(locale, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </td>
                  <td style={{ padding: "10px", paddingRight: "30px", maxWidth: "350px", overflow: "hidden", textOverflow: "ellipsis", color: "white", position: "relative", whiteSpace: "nowrap" }}>
                    {getMessageExcerpt(msg.lastMessage)}
                    <span style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)" }}>{msg.senderType === "bot" ? "🤖" : "👤"}</span>
                  </td>
                  <td style={{ padding: "10px", textAlign: "center" }}>
                    <span title={getIntentDisplay(status?.purchaseIntent).label} style={{ fontSize: "1.2rem" }}>
                      {getIntentDisplay(status?.purchaseIntent).emoji}
                    </span>
                  </td>
                  <td style={{ padding: "10px" }}>
                    {needsHelp && handoffStyle ? (
                      <div>
                        <span style={{ color: handoffStyle.textColor, fontWeight: "bold", fontSize: "0.9rem" }}>{handoffStyle.icon} {handoffStyle.label}</span>
                        {status?.handoffReason && (
                          <div style={{ fontSize: "0.75em", color: "#aaa", marginTop: "4px" }}>
                            {status.handoffReason}
                          </div>
                        )}
                      </div>
                    ) : isHumanActive ? (
                      <span style={{ color: "#ff9800", fontSize: "0.9rem" }}>👨‍💼 {t('messages.human')}</span>
                    ) : (
                      <span style={{ color: "#4caf50", fontSize: "0.9rem" }}>🤖 {t('messages.bot')}</span>
                    )}
                  </td>
                  <td style={{ padding: "10px" }}>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      {isHumanActive ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRelease(msg.psid);
                          }}
                          disabled={loading[msg.psid]}
                          style={{
                            padding: "6px 12px",
                            backgroundColor: "#4caf50",
                            color: "white",
                            border: "none",
                            borderRadius: "8px",
                            cursor: loading[msg.psid] ? "not-allowed" : "pointer",
                            opacity: loading[msg.psid] ? 0.6 : 1,
                            fontSize: "0.85rem"
                          }}
                        >
                          {loading[msg.psid] ? "..." : `🤖 ${t('messages.releaseBot')}`}
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTakeover(msg.psid);
                          }}
                          disabled={loading[msg.psid]}
                          style={{
                            padding: "6px 12px",
                            backgroundColor: "#ff9800",
                            color: "white",
                            border: "none",
                            borderRadius: "8px",
                            cursor: loading[msg.psid] ? "not-allowed" : "pointer",
                            opacity: loading[msg.psid] ? 0.6 : 1,
                            fontSize: "0.85rem"
                          }}
                        >
                          {loading[msg.psid] ? "..." : `👨‍💼 ${t('messages.takeOver')}`}
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPsid(msg.psid);
                          setSelectedChannel(msg.channel);
                          fetchFullConversation(msg.psid);
                        }}
                        style={{
                          padding: "6px 12px",
                          backgroundColor: "#2196F3",
                          color: "white",
                          border: "none",
                          borderRadius: "8px",
                          cursor: "pointer",
                          fontSize: "0.85rem"
                        }}
                      >
                        💬
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>}

      {/* SECTION 2: All Conversations Table with Date Filtering */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <FeatureTip id="messages-search" title="Conversaciones" text="Aquí aparecen todas las conversaciones del bot. Haz click en una para ver el historial completo y tomar el control." position="bottom">
            <h2 style={{ color: "white", margin: 0, fontSize: "1.3rem", fontWeight: "bold" }}>
              💬 {t('messages.allConversations')} - {totalConversations !== 1 ? t('messages.conversationCountPlural', { count: totalConversations }) : t('messages.conversationCount', { count: totalConversations })}
            </h2>
          </FeatureTip>
          {conversationsNeedingHelp > 0 && (
            <div style={{
              backgroundColor: "#ff5252",
              color: "white",
              padding: "8px 16px",
              borderRadius: "20px",
              fontWeight: "bold",
              fontSize: "0.9rem",
              animation: "pulse 2s infinite"
            }}>
              🚨 {conversationsNeedingHelp > 1 ? t('messages.needsHelpPlural', { count: conversationsNeedingHelp }) : t('messages.needsHelp', { count: conversationsNeedingHelp })}
            </div>
          )}
        </div>

        {/* Date Filter Buttons */}
        <div style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {[
            { key: 'today', label: t('messages.filterToday') },
            { key: 'yesterday', label: t('messages.filterYesterday') },
            { key: 'week', label: t('messages.filterWeek') },
            { key: 'month', label: t('messages.filterMonth') },
            { key: 'all', label: t('messages.filterAll') }
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setDateFilter(key)}
              style={{
                padding: "0.5rem 1rem",
                backgroundColor: dateFilter === key ? "#4caf50" : "rgba(255, 255, 255, 0.1)",
                color: "white",
                border: dateFilter === key ? "2px solid #4caf50" : "1px solid #555",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: dateFilter === key ? "bold" : "normal",
                transition: "all 0.2s ease",
                fontSize: "0.9rem"
              }}
              onMouseEnter={(e) => {
                if (dateFilter !== key) {
                  e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.15)";
                }
              }}
              onMouseLeave={(e) => {
                if (dateFilter !== key) {
                  e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Main conversations table */}
        <div style={{ position: "relative" }}>
          {loadingFiltered && (
            <div style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0,0,0,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
              borderRadius: "4px"
            }}>
              <div style={{
                width: "30px",
                height: "30px",
                border: "3px solid rgba(255,255,255,0.1)",
                borderTopColor: "#4caf50",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite"
              }} />
            </div>
          )}
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem", border: "1px solid #555" }}>
          <thead>
            <tr style={{ backgroundColor: "#1b3a1b", color: "lightgreen" }}>
              <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.channel')}</th>
              <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.user')}</th>
              <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.date')}</th>
              <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.lastMessageCol')}</th>
              <th style={{ padding: "8px", textAlign: "center", borderBottom: "2px solid #555" }}>{t('messages.intent')}</th>
              <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.senderType')}</th>
              <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.spokesperson')}</th>
              <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('messages.action')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredConversations.map((msg) => {
              const status = conversationStatuses[msg.psid];
              const isHumanActive = status?.humanActive;
              const needsHelp = status?.handoffRequested && !isHumanActive;
              const channelDisplay = getChannelDisplay(msg.channel);
              const handoffStyle = needsHelp ? getHandoffStyle(status?.handoffReason) : null;

              return (
                <tr
                  key={msg.psid}
                  onClick={() => {
                    setSelectedPsid(msg.psid);
                    setSelectedChannel(msg.channel);
                    fetchFullConversation(msg.psid);
                  }}
                  style={{
                    borderBottom: "1px solid #555",
                    cursor: "pointer",
                    backgroundColor: handoffStyle ? handoffStyle.backgroundColor : "transparent",
                    borderLeft: handoffStyle ? `4px solid ${handoffStyle.borderColor}` : "none"
                  }}
                >
                  <td style={{ padding: "8px", textAlign: "center" }}>
                    <span
                      style={{
                        backgroundColor: channelDisplay.color,
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 'bold'
                      }}
                      title={channelDisplay.label}
                    >
                      {channelDisplay.icon}
                    </span>
                  </td>
                  <td style={{ padding: "8px", color: "#e0e0e0", fontSize: "0.85rem" }}>
                    {msg.channel === 'whatsapp' && msg.psid?.startsWith('wa:') ? (
                      <span
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(msg.psid.substring(3));
                          alert(t('messages.numberCopied', { number: msg.psid.substring(3) }));
                        }}
                        title="Click para copiar"
                      >
                        📱 {msg.psid.substring(3)}
                      </span>
                    ) : (
                      <span style={{ color: '#888' }}>{msg.psid?.substring(0, 10)}...</span>
                    )}
                  </td>
                  <td style={{ padding: "8px", color: "#e0e0e0" }}>{new Date(msg.lastMessageAt).toLocaleString()}</td>
                  <td style={{ padding: "8px", paddingRight: "30px", maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis", color: "white", position: "relative", whiteSpace: "nowrap" }}>
                    {getMessageExcerpt(msg.lastMessage)}
                    <span style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)" }}>{msg.senderType === "bot" ? "🤖" : "👤"}</span>
                  </td>
                  <td style={{ padding: "8px", textAlign: "center" }}>
                    <span title={getIntentDisplay(status?.purchaseIntent).label} style={{ fontSize: "1.2rem" }}>
                      {getIntentDisplay(status?.purchaseIntent).emoji}
                    </span>
                  </td>
                  <td style={{ padding: "8px", color: msg.senderType === "bot" ? "lightblue" : "white" }}>
                    {msg.senderType}
                  </td>
                  <td style={{ padding: "8px" }}>
                    {needsHelp && handoffStyle ? (
                      <div>
                        <span style={{ color: handoffStyle.textColor, fontWeight: "bold" }}>{handoffStyle.icon} {handoffStyle.label}</span>
                        {status?.handoffReason && (
                          <div style={{ fontSize: "0.75em", color: "#aaa", marginTop: "4px" }}>
                            {status.handoffReason}
                          </div>
                        )}
                      </div>
                    ) : isHumanActive ? (
                      <span style={{ color: "#ff9800" }}>👨‍💼 {t('messages.human')}</span>
                    ) : (
                      <span style={{ color: "#4caf50" }}>🤖 {t('messages.bot')}</span>
                    )}
                  </td>
                  <td style={{ padding: "8px" }}>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      {isHumanActive ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRelease(msg.psid);
                          }}
                          disabled={loading[msg.psid]}
                          style={{
                            padding: "6px 12px",
                            backgroundColor: "#4caf50",
                            color: "white",
                            border: "none",
                            borderRadius: "8px",
                            cursor: loading[msg.psid] ? "not-allowed" : "pointer",
                            opacity: loading[msg.psid] ? 0.6 : 1
                          }}
                        >
                          {loading[msg.psid] ? "..." : `🤖 ${t('messages.releaseToBot')}`}
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTakeover(msg.psid);
                          }}
                          disabled={loading[msg.psid]}
                          style={{
                            padding: "6px 12px",
                            backgroundColor: "#ff9800",
                            color: "white",
                            border: "none",
                            borderRadius: "8px",
                            cursor: loading[msg.psid] ? "not-allowed" : "pointer",
                            opacity: loading[msg.psid] ? 0.6 : 1
                          }}
                        >
                          {loading[msg.psid] ? "..." : `👨‍💼 ${t('messages.takeControl')}`}
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPsid(msg.psid);
                          setSelectedChannel(msg.channel);
                          fetchFullConversation(msg.psid);
                        }}
                        style={{
                          padding: "6px 12px",
                          backgroundColor: "#2196F3",
                          color: "white",
                          border: "none",
                          borderRadius: "8px",
                          cursor: "pointer"
                        }}
                      >
                        💬
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "1rem",
            marginTop: "1rem",
            padding: "0.75rem"
          }}>
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1 || loadingFiltered}
              style={{
                padding: "8px 16px",
                backgroundColor: currentPage <= 1 ? "#333" : "#4caf50",
                color: "white",
                border: "none",
                borderRadius: "8px",
                cursor: currentPage <= 1 ? "not-allowed" : "pointer",
                opacity: currentPage <= 1 ? 0.5 : 1,
                fontSize: "0.9rem"
              }}
            >
              {t('messages.previous')}
            </button>
            <span style={{ color: "#ccc", fontSize: "0.9rem" }}>
              {t('messages.page', { current: currentPage, total: totalPages, count: totalConversations })}
            </span>
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages || loadingFiltered}
              style={{
                padding: "8px 16px",
                backgroundColor: currentPage >= totalPages ? "#333" : "#4caf50",
                color: "white",
                border: "none",
                borderRadius: "8px",
                cursor: currentPage >= totalPages ? "not-allowed" : "pointer",
                opacity: currentPage >= totalPages ? 0.5 : 1,
                fontSize: "0.9rem"
              }}
            >
              {t('messages.next')}
            </button>
          </div>
        )}
      </div>

      {/* Conversation Detail Modal */}
      {selectedPsid && (
        <div
          onClick={() => {
            setSelectedPsid(null);
            setSelectedChannel(null);
            setShowLinkGenerator(false);
            setShowSaleForm(false);
          }}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: "#1a1a1a",
              borderRadius: "8px",
              width: "90%",
              maxWidth: "800px",
              maxHeight: "92vh",
              display: "flex",
              flexDirection: "column",
              border: "1px solid #2a2a2a",
              overflow: "hidden"
            }}
          >
            {/* Header */}
            <div style={{ padding: "1rem", borderBottom: "1px solid #2a2a2a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span
                  style={{
                    backgroundColor: getChannelDisplay(selectedChannel).color,
                    color: 'white',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    fontSize: '0.9rem',
                    fontWeight: 'bold'
                  }}
                  title={getChannelDisplay(selectedChannel).label}
                >
                  {getChannelDisplay(selectedChannel).icon}
                </span>
                <div>
                  <h3 style={{ margin: 0, color: "white" }}>
                    {selectedChannel === 'whatsapp' && selectedPsid.startsWith('wa:') ? (
                      <>
                        📱 {selectedPsid.substring(3)}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(selectedPsid.substring(3));
                            alert(t('messages.numberCopied', { number: selectedPsid.substring(3) }));
                          }}
                          style={{
                            marginLeft: '8px',
                            padding: '4px 8px',
                            fontSize: '0.75rem',
                            backgroundColor: '#25D366',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                          title={t('messages.copyNumber')}
                        >
                          📋 {t('messages.copy')}
                        </button>
                        <a
                          href={`https://wa.me/${selectedPsid.substring(3)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            marginLeft: '8px',
                            padding: '4px 8px',
                            fontSize: '0.75rem',
                            backgroundColor: '#25D366',
                            color: 'white',
                            borderRadius: '4px',
                            textDecoration: 'none'
                          }}
                          title={t('messages.openWhatsApp')}
                        >
                          💬 WhatsApp
                        </a>
                      </>
                    ) : (
                      <>{t('messages.conversation')} - {selectedPsid.substring(0, 15)}...</>
                    )}
                  </h3>
                  {selectedChannel === 'whatsapp' && (
                    <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#888' }}>
                      {t('messages.whatsappNote')}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => {
                  setSelectedPsid(null);
                  setSelectedChannel(null);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "white",
                  fontSize: "1.5rem",
                  cursor: "pointer"
                }}
              >
                &times;
              </button>
            </div>

            {/* Messages */}
            <div style={{ flex: "1 1 200px", minHeight: "120px", overflowY: "auto", padding: "1rem" }}>
              {fullConversation.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    marginBottom: "1rem",
                    padding: "0.75rem",
                    borderRadius: "8px",
                    backgroundColor: msg.senderType === "bot" ? "#1e3a5f" : msg.senderType === "human" ? "#3a5f1e" : "#2a2a2a"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem", fontSize: "0.85rem", color: "#888" }}>
                    <span>{msg.senderType === "bot" ? `🤖 ${t('messages.bot')}` : msg.senderType === "human" ? `👨‍💼 ${t('messages.agent')}` : `👤 ${t('messages.user')}`}</span>
                    <span>{new Date(msg.timestamp).toLocaleString()}</span>
                  </div>
                  {(() => {
                    // Parse attachment marker: "[Imagen: <url>] caption" or "[PDF: <url>] caption"
                    const match = msg.text?.match(/^\[(Imagen|PDF):\s*(https?:\/\/[^\]]+)\]\s*(.*)$/s);
                    if (match) {
                      const [, type, url, caption] = match;
                      return (
                        <div>
                          {type === 'Imagen' ? (
                            <img src={url} alt="" style={{ maxWidth: "100%", maxHeight: "300px", borderRadius: "6px", marginBottom: caption ? "0.5rem" : 0 }} />
                          ) : (
                            <a href={url} target="_blank" rel="noreferrer" style={{ display: "inline-block", padding: "0.5rem 0.75rem", backgroundColor: "rgba(0,0,0,0.3)", borderRadius: "6px", color: "white", textDecoration: "none", marginBottom: caption ? "0.5rem" : 0 }}>
                              📄 Ver PDF
                            </a>
                          )}
                          {caption && <p style={{ margin: 0, whiteSpace: "pre-wrap", color: "white" }}>{caption}</p>}
                        </div>
                      );
                    }
                    return <p style={{ margin: 0, whiteSpace: "pre-wrap", color: "white" }}>{msg.text}</p>;
                  })()}
                </div>
              ))}
            </div>

            {/* Bottom stack: reply + action buttons + optional panels — scrollable as a group */}
            <div style={{ flex: "0 0 auto", maxHeight: "55vh", overflowY: "auto", borderTop: "1px solid #2a2a2a" }}>
            {/* Reply Input */}
            <div style={{ padding: "1rem" }}>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {/* Hidden file input */}
                <input
                  type="file"
                  id="attachment-input"
                  accept="image/*,application/pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleSendAttachment(file);
                    e.target.value = ''; // reset so same file can be re-selected
                  }}
                  disabled={sendingReply}
                />
                {/* Attachment button - opens gallery */}
                <button
                  type="button"
                  onClick={openGallery}
                  disabled={sendingReply}
                  title="Adjuntar imagen o PDF (galería + subir nuevo)"
                  style={{
                    padding: "12px 14px",
                    borderRadius: "8px",
                    border: `2px solid ${getChannelDisplay(selectedChannel).color}40`,
                    backgroundColor: "#2a2a2a",
                    color: "white",
                    cursor: sendingReply ? 'not-allowed' : 'pointer',
                    fontSize: "1.2rem",
                    opacity: sendingReply ? 0.6 : 1
                  }}>
                  📎
                </button>
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && !sendingReply && handleSendReply()}
                  placeholder={t('messages.replyVia', { channel: getChannelDisplay(selectedChannel).label })}
                  style={{
                    flex: 1,
                    padding: "12px",
                    borderRadius: "8px",
                    border: `2px solid ${getChannelDisplay(selectedChannel).color}40`,
                    backgroundColor: "#2a2a2a",
                    color: "white",
                    fontSize: "1rem"
                  }}
                  disabled={sendingReply}
                />
                <button
                  onClick={handleSendReply}
                  disabled={sendingReply || !replyText.trim()}
                  style={{
                    padding: "12px 24px",
                    backgroundColor: getChannelDisplay(selectedChannel).color,
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    cursor: sendingReply || !replyText.trim() ? "not-allowed" : "pointer",
                    opacity: sendingReply || !replyText.trim() ? 0.6 : 1,
                    fontWeight: "bold"
                  }}
                >
                  {sendingReply ? "..." : t('messages.sendChannel', { icon: getChannelDisplay(selectedChannel).icon })}
                </button>
              </div>
            </div>

            {/* Footer with handover controls */}
            <div style={{ padding: "1rem", borderTop: "1px solid #2a2a2a", display: "flex", gap: "0.5rem", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.9rem", color: "#888" }}>
                {t('messages.status')}: {conversationStatuses[selectedPsid]?.humanActive ? `👨‍💼 ${t('messages.human')}` : `🤖 ${t('messages.bot')}`}
              </span>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={() => {
                    const storeUrl = `https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob?psid=${encodeURIComponent(selectedPsid)}#from=share_eshop`;
                    navigator.clipboard.writeText(storeUrl);
                    alert(t('messages.storeLinkCopied'));
                  }}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#FFE600",
                    color: "#333",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontWeight: "bold"
                  }}
                  title={t('messages.copyStoreLink')}
                >
                  🏪 ML
                </button>
                <button
                  onClick={() => { setShowLinkGenerator(!showLinkGenerator); setShowSaleForm(false); }}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: showLinkGenerator ? "#2196f3" : "#1976d2",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "pointer"
                  }}
                >
                  {showLinkGenerator ? `✕ ${t('messages.closeLink')}` : `🔗 ${t('messages.generateLink')}`}
                </button>
                <FeatureTip id="messages-sale" title="Registrar venta" text="Registra una venta manual para esta conversación. Se vincula automáticamente al cliente." position="left">
                  <button
                    onClick={() => { setShowSaleForm(!showSaleForm); setShowLinkGenerator(false); }}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: showSaleForm ? "#4caf50" : "#388e3c",
                      color: "white",
                      border: "none",
                      borderRadius: "8px",
                      cursor: "pointer"
                    }}
                  >
                    {showSaleForm ? `✕ ${t('messages.closeSale')}` : `💲 ${t('messages.registerSale')}`}
                  </button>
                </FeatureTip>
                <button
                  onClick={() => handleResumeBot(selectedPsid)}
                  disabled={resumingBot}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#7c4dff",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    cursor: resumingBot ? "not-allowed" : "pointer",
                    opacity: resumingBot ? 0.6 : 1
                  }}
                  title={t('messages.resumeBotTitle')}
                >
                  {resumingBot ? "..." : t('messages.resumeBot')}
                </button>
                {conversationStatuses[selectedPsid]?.humanActive ? (
                  <button
                    onClick={() => handleRelease(selectedPsid)}
                    disabled={loading[selectedPsid]}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: "#4caf50",
                      color: "white",
                      border: "none",
                      borderRadius: "8px",
                      cursor: loading[selectedPsid] ? "not-allowed" : "pointer",
                      opacity: loading[selectedPsid] ? 0.6 : 1
                    }}
                  >
                    {loading[selectedPsid] ? "..." : `🤖 ${t('messages.releaseToBot')}`}
                  </button>
                ) : (
                  <button
                    onClick={() => handleTakeover(selectedPsid)}
                    disabled={loading[selectedPsid]}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: "#ff9800",
                      color: "white",
                      border: "none",
                      borderRadius: "8px",
                      cursor: loading[selectedPsid] ? "not-allowed" : "pointer",
                      opacity: loading[selectedPsid] ? 0.6 : 1
                    }}
                  >
                    {loading[selectedPsid] ? "..." : `👨‍💼 ${t('messages.takeControl')}`}
                  </button>
                )}
                <button
                  onClick={() => {
                    setSelectedPsid(null);
                    setSelectedChannel(null);
                    setShowLinkGenerator(false);
                    setShowSaleForm(false);
                  }}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#666",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "pointer"
                  }}
                >
                  {t('messages.close')}
                </button>
              </div>
            </div>

            {/* Commerce status + report-as-ticket */}
            <div style={{ padding: "0 1rem 1rem 1rem" }}>
              <ConversationCommercePanel psid={selectedPsid} />
              {/* Handoff reason + collected client data for the agent taking over */}
              <ConversationHandoffPanel psid={selectedPsid} />
            </div>

            {/* Tracked Link Generator */}
            {showLinkGenerator && (
              <div style={{ padding: "0 1rem 1rem 1rem" }}>
                <TrackedLinkGenerator
                  psid={selectedPsid}
                  onClose={() => setShowLinkGenerator(false)}
                />
              </div>
            )}

            {/* Manual Sale Form */}
            {showSaleForm && (
              <div style={{ padding: "0 1rem 1rem 1rem" }}>
                <ManualSaleForm
                  psid={selectedPsid}
                  channel={selectedChannel}
                  onClose={() => setShowSaleForm(false)}
                />
              </div>
            )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Messages;
