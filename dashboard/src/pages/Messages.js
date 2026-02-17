import React, { useEffect, useState, useRef, useCallback } from "react";
import API from "../api";
import TrackedLinkGenerator from "../components/TrackedLinkGenerator";

function Messages() {
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
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [pendingHandoffs, setPendingHandoffs] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalConversations, setTotalConversations] = useState(0);
  const [loadingFiltered, setLoadingFiltered] = useState(false);

  const quickActionPsidsRef = useRef([]);
  const currentPageRef = useRef(1);
  const dateFilterRef = useRef('today');

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
        return { emoji: '🟢', color: '#4caf50', label: 'Alta' };
      case 'low':
        return { emoji: '🔴', color: '#f44336', label: 'Baja' };
      case 'medium':
      default:
        return { emoji: '🔵', color: '#2196F3', label: 'Media' };
    }
  };

  // Helper function to format wait time
  const formatWaitTime = (minutes) => {
    if (minutes == null) return '';
    if (minutes < 60) return `hace ${minutes}min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours}h`;
    const days = Math.floor(hours / 24);
    return `hace ${days}d`;
  };

  // Helper function to determine handoff type and colors
  const getHandoffStyle = (handoffReason) => {
    // Sales opportunity handoffs (green/teal)
    const isSalesOpportunity = handoffReason && (
      handoffReason === 'human_sellable_product_order' ||
      handoffReason.startsWith('Custom order') ||
      handoffReason.includes('requiere cotización') ||
      handoffReason.includes('pedido especial')
    );

    if (isSalesOpportunity) {
      return {
        backgroundColor: '#0d3320',      // Dark green
        borderColor: '#4caf50',          // Green
        textColor: '#4caf50',
        icon: '💰',
        label: 'Oportunidad de Venta'
      };
    }

    // Error/escalation handoffs (red - default)
    return {
      backgroundColor: '#4a1515',        // Dark red
      borderColor: '#ff5252',            // Red
      textColor: '#ff5252',
      icon: '🚨',
      label: 'Necesita Ayuda'
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
      const res = await API.get("/conversations/grouped?limit=10");
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
        limit: '20',
        start: start.toISOString(),
        end: end.toISOString()
      });
      if (exclude.length > 0) {
        params.set('excludePsids', exclude.join(','));
      }
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

  useEffect(() => {
    const init = async () => {
      // Fetch quick actions + pending handoffs in parallel
      const [excludePsids] = await Promise.all([
        fetchQuickActions(),
        fetchPendingHandoffs()
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
  }, [fetchQuickActions, fetchFilteredPage]);

  // Refetch filtered page when date filter changes
  useEffect(() => {
    dateFilterRef.current = dateFilter;
    if (!initialLoading) {
      setCurrentPage(1);
      currentPageRef.current = 1;
      fetchFilteredPage(1);
    }
  }, [dateFilter]); // eslint-disable-line react-hooks/exhaustive-deps

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

      alert(`✅ Control tomado del PSID: ${psid}\nEl bot dejará de responder.`);
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

      alert(`✅ Conversación liberada: ${psid}\nEl bot puede responder de nuevo.`);
    } catch (err) {
      console.error("Error releasing:", err);
      alert(`❌ Error: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(prev => ({ ...prev, [psid]: false }));
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
      alert(`❌ Error enviando mensaje: ${err.response?.data?.error || err.message}`);
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
        <p style={{ color: "#888", fontSize: "1rem" }}>Cargando conversaciones...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div>
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
          {refreshing ? "🔄 Actualizando..." : "🔄 Actualizar"}
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
              Pendientes de Atención - {pendingHandoffs.length}
            </h2>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #555" }}>
            <thead>
              <tr style={{ backgroundColor: "#3d2900", color: "#ffb300" }}>
                <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>Canal</th>
                <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>Usuario</th>
                <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>Esperando desde</th>
                <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>Motivo</th>
                <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>Producto</th>
                <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>Ciudad</th>
                <th style={{ padding: "10px", textAlign: "center", borderBottom: "2px solid #555" }}>Intención</th>
                <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {pendingHandoffs.map((handoff) => {
                const channelDisplay = getChannelDisplay(handoff.channel);
                const intentDisplay = getIntentDisplay(handoff.purchaseIntent);
                return (
                  <tr
                    key={handoff.psid}
                    onClick={() => {
                      setSelectedPsid(handoff.psid);
                      setSelectedChannel(handoff.channel);
                      fetchFullConversation(handoff.psid);
                    }}
                    style={{
                      borderBottom: "1px solid #555",
                      cursor: "pointer",
                      borderLeft: handoff.isAfterHours ? "4px solid #ff9800" : "4px solid transparent",
                      backgroundColor: "transparent"
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
                            alert('Número copiado: ' + handoff.psid.substring(3));
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
                        {handoff.handoffTimestamp ? new Date(handoff.handoffTimestamp).toLocaleString('es-MX', {
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
                          Fuera de horario
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "10px", color: "#e0e0e0", fontSize: "0.85rem", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {getMessageExcerpt(handoff.handoffReason, 40) || '—'}
                    </td>
                    <td style={{ padding: "10px", color: "#e0e0e0", fontSize: "0.85rem" }}>
                      {handoff.productInterest || handoff.currentFlow || '—'}
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
                        {loading[handoff.psid] ? "..." : "Tomar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* SECTION 1: Recent Activity Table */}
      <div style={{ marginBottom: "2.5rem" }}>
        <h2 style={{ color: "white", marginBottom: "1rem", fontSize: "1.3rem", fontWeight: "bold" }}>
          ⚡ Actividad Reciente - Últimas 10 Conversaciones
        </h2>
        <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #555" }}>
          <thead>
            <tr style={{ backgroundColor: "#2a1a5e", color: "#bb86fc" }}>
              <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>Canal</th>
              <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>Usuario</th>
              <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>Fecha</th>
              <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>Último mensaje</th>
              <th style={{ padding: "10px", textAlign: "center", borderBottom: "2px solid #555" }}>Intención</th>
              <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>Vocero</th>
              <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>Acción</th>
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
                          alert('Número copiado: ' + msg.psid.substring(3));
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
                    {new Date(msg.lastMessageAt).toLocaleString('es-MX', {
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
                      <span style={{ color: "#ff9800", fontSize: "0.9rem" }}>👨‍💼 Humano</span>
                    ) : (
                      <span style={{ color: "#4caf50", fontSize: "0.9rem" }}>🤖 Bot</span>
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
                          {loading[msg.psid] ? "..." : "🤖 Liberar"}
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
                          {loading[msg.psid] ? "..." : "👨‍💼 Tomar"}
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
      </div>

      {/* SECTION 2: All Conversations Table with Date Filtering */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ color: "white", margin: 0, fontSize: "1.3rem", fontWeight: "bold" }}>
            💬 Todas las Conversaciones - {totalConversations} conversación{totalConversations !== 1 ? 'es' : ''}
          </h2>
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
              🚨 {conversationsNeedingHelp} conversación{conversationsNeedingHelp > 1 ? 'es' : ''} necesita{conversationsNeedingHelp === 1 ? '' : 'n'} ayuda
            </div>
          )}
        </div>

        {/* Date Filter Buttons */}
        <div style={{ marginBottom: "1rem" }}>
          <div style={{
            display: "flex",
            gap: "0.5rem",
            flexWrap: "wrap"
          }}>
            {[
              { key: 'today', label: 'Hoy' },
              { key: 'yesterday', label: 'Ayer' },
              { key: 'week', label: 'Últimos 7 días' },
              { key: 'month', label: 'Últimos 30 días' },
              { key: 'all', label: 'Todos' }
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
              <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>Canal</th>
              <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>Usuario</th>
              <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>Fecha</th>
              <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>Último mensaje</th>
              <th style={{ padding: "8px", textAlign: "center", borderBottom: "2px solid #555" }}>Intención</th>
              <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>Tipo</th>
              <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>Vocero</th>
              <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>Acción</th>
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
                          alert('Número copiado: ' + msg.psid.substring(3));
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
                      <span style={{ color: "#ff9800" }}>👨‍💼 Humano</span>
                    ) : (
                      <span style={{ color: "#4caf50" }}>🤖 Bot</span>
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
                          {loading[msg.psid] ? "..." : "🤖 Liberar al Bot"}
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
                          {loading[msg.psid] ? "..." : "👨‍💼 Tomar Control"}
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
              Anterior
            </button>
            <span style={{ color: "#ccc", fontSize: "0.9rem" }}>
              Página {currentPage} de {totalPages} ({totalConversations} conversaciones)
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
              Siguiente
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
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              border: "1px solid #2a2a2a"
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
                            alert('Número copiado: ' + selectedPsid.substring(3));
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
                          title="Copiar número"
                        >
                          📋 Copiar
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
                          title="Abrir en WhatsApp"
                        >
                          💬 WhatsApp
                        </a>
                      </>
                    ) : (
                      <>Conversación - {selectedPsid.substring(0, 15)}...</>
                    )}
                  </h3>
                  {selectedChannel === 'whatsapp' && (
                    <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#888' }}>
                      WhatsApp • Puedes llamar o enviar mensaje directo
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
            <div style={{ flex: 1, overflowY: "auto", padding: "1rem" }}>
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
                    <span>{msg.senderType === "bot" ? "🤖 Bot" : msg.senderType === "human" ? "👨‍💼 Agente" : "👤 Usuario"}</span>
                    <span>{new Date(msg.timestamp).toLocaleString()}</span>
                  </div>
                  <p style={{ margin: 0, whiteSpace: "pre-wrap", color: "white" }}>{msg.text}</p>
                </div>
              ))}
            </div>

            {/* Reply Input */}
            <div style={{ padding: "1rem", borderTop: "1px solid #2a2a2a" }}>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && !sendingReply && handleSendReply()}
                  placeholder={`Responder por ${getChannelDisplay(selectedChannel).label}...`}
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
                  {sendingReply ? "..." : `Enviar ${getChannelDisplay(selectedChannel).icon}`}
                </button>
              </div>
            </div>

            {/* Footer with handover controls */}
            <div style={{ padding: "1rem", borderTop: "1px solid #2a2a2a", display: "flex", gap: "0.5rem", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.9rem", color: "#888" }}>
                Estado: {conversationStatuses[selectedPsid]?.humanActive ? "👨‍💼 Humano" : "🤖 Bot"}
              </span>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={() => setShowLinkGenerator(!showLinkGenerator)}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: showLinkGenerator ? "#2196f3" : "#1976d2",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "pointer"
                  }}
                >
                  {showLinkGenerator ? "✕ Cerrar Enlace" : "🔗 Generar Enlace"}
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
                    {loading[selectedPsid] ? "..." : "🤖 Liberar al Bot"}
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
                    {loading[selectedPsid] ? "..." : "👨‍💼 Tomar Control"}
                  </button>
                )}
                <button
                  onClick={() => {
                    setSelectedPsid(null);
                    setSelectedChannel(null);
                    setShowLinkGenerator(false);
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
                  Cerrar
                </button>
              </div>
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
          </div>
        </div>
      )}
    </div>
  );
}

export default Messages;
