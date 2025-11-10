import React, { useEffect, useState } from "react";
import API from "../api";

function Messages() {
  const [messages, setMessages] = useState([]);
  const [conversationStatuses, setConversationStatuses] = useState({});
  const [loading, setLoading] = useState({});
  const [selectedPsid, setSelectedPsid] = useState(null);
  const [fullConversation, setFullConversation] = useState([]);
  const [dateFilter, setDateFilter] = useState('today');

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

  const fetchFullConversation = async (psid) => {
    try {
      const res = await API.get(`/conversations/${psid}`);
      setFullConversation(res.data);
    } catch (err) {
      console.error("Error fetching full conversation:", err);
    }
  };

  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const res = await API.get("/conversations");
        setMessages(res.data);

        // Fetch status for each unique PSID
        const uniquePSIDs = [...new Set(res.data.map(m => m.psid))];
        const statuses = {};
        for (const psid of uniquePSIDs) {
          try {
            const statusRes = await API.get(`/api/conversation/${psid}/status`);
            statuses[psid] = statusRes.data;
          } catch (err) {
            console.error(`Error fetching status for ${psid}:`, err);
          }
        }
        setConversationStatuses(statuses);
      } catch (err) {
        console.error(err);
      }
    };
    fetchMessages();
  }, []);

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

  // Group messages by PSID to show only the latest message per conversation
  const latestMessages = messages.reduce((acc, msg) => {
    if (!acc[msg.psid] || new Date(msg.timestamp) > new Date(acc[msg.psid].timestamp)) {
      acc[msg.psid] = msg;
    }
    return acc;
  }, {});

  // Get 10 most recent conversations for quick actions (always unfiltered)
  const quickActionConversations = Object.values(latestMessages)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 10);

  // Filter conversations based on selected date range
  const { start, end } = getDateRange(dateFilter);
  const filteredMessages = Object.values(latestMessages).filter(msg => {
    const msgDate = new Date(msg.timestamp);
    return msgDate >= start && msgDate < end;
  });

  // Count conversations needing help (from filtered list)
  const conversationsNeedingHelp = filteredMessages.filter(msg => {
    const status = conversationStatuses[msg.psid];
    return status?.handoffRequested && !status?.humanActive;
  }).length;

  return (
    <div>
      {/* Quick Actions Section */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ color: "white", marginBottom: "0.75rem", fontSize: "1.1rem" }}>
          Acciones Rápidas
        </h3>
        <div style={{
          display: "flex",
          gap: "1rem",
          overflowX: "auto",
          paddingBottom: "0.5rem",
          scrollbarWidth: "thin",
          scrollbarColor: "#4caf50 #1a1a1a"
        }}>
          {quickActionConversations.map((msg) => {
            const status = conversationStatuses[msg.psid];
            const isHumanActive = status?.humanActive;
            const needsHelp = status?.handoffRequested && !isHumanActive;

            let statusIcon = "🤖";
            let statusText = "Bot";
            let statusColor = "#4caf50";

            if (needsHelp) {
              statusIcon = "🚨";
              statusText = "Needs Help";
              statusColor = "#ff5252";
            } else if (isHumanActive) {
              statusIcon = "👨‍💼";
              statusText = "Human";
              statusColor = "#ff9800";
            }

            return (
              <div
                key={msg.psid}
                onClick={() => {
                  setSelectedPsid(msg.psid);
                  fetchFullConversation(msg.psid);
                }}
                style={{
                  minWidth: "250px",
                  padding: "1rem",
                  background: "rgba(255, 255, 255, 0.05)",
                  backdropFilter: "blur(10px)",
                  border: `1px solid ${statusColor}40`,
                  borderRadius: "12px",
                  cursor: "pointer",
                  transition: "all 0.3s ease",
                  boxShadow: needsHelp ? `0 0 20px ${statusColor}40` : "0 4px 6px rgba(0,0,0,0.1)"
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = `0 8px 12px ${statusColor}40`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = needsHelp ? `0 0 20px ${statusColor}40` : "0 4px 6px rgba(0,0,0,0.1)";
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <span style={{
                    fontFamily: "monospace",
                    fontSize: "0.85rem",
                    color: "#aaa",
                    fontWeight: "500"
                  }}>
                    {msg.psid.substring(0, 8)}...
                  </span>
                  <span style={{
                    fontSize: "0.75rem",
                    color: statusColor,
                    fontWeight: "bold",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px"
                  }}>
                    {statusIcon} {statusText}
                  </span>
                </div>
                <div style={{
                  fontSize: "0.9rem",
                  color: "white",
                  marginBottom: "0.5rem",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}>
                  {msg.text}
                </div>
                <div style={{
                  fontSize: "0.75rem",
                  color: "#666",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}>
                  <span>{new Date(msg.timestamp).toLocaleString('es-MX', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Date Filter Buttons */}
      <div style={{ marginBottom: "1.5rem" }}>
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

      {/* Header with count */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ color: "white", margin: 0 }}>
          💬 Conversaciones registradas - {filteredMessages.length} conversación{filteredMessages.length !== 1 ? 'es' : ''}
          <span style={{ fontSize: "0.7em", color: "#888", marginLeft: "1rem" }}>[v2.0]</span>
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

      {/* Main conversations table */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem", border: "1px solid #555" }}>
        <thead>
          <tr style={{ backgroundColor: "#1b3a1b", color: "lightgreen" }}>
            <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>Fecha</th>
            <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>PSID</th>
            <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>Último mensaje</th>
            <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>Tipo</th>
            <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>Estado</th>
            <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #555" }}>Acción</th>
          </tr>
        </thead>
        <tbody>
          {filteredMessages.map((msg) => {
            const status = conversationStatuses[msg.psid];
            const isHumanActive = status?.humanActive;
            const needsHelp = status?.handoffRequested && !isHumanActive;

            return (
              <tr
                key={msg._id}
                onClick={() => {
                  setSelectedPsid(msg.psid);
                  fetchFullConversation(msg.psid);
                }}
                style={{
                  borderBottom: "1px solid #555",
                  cursor: "pointer",
                  backgroundColor: needsHelp ? "#4a1515" : "transparent",
                  borderLeft: needsHelp ? "4px solid #ff5252" : "none"
                }}
              >
                <td style={{ padding: "8px", color: "#e0e0e0" }}>{new Date(msg.timestamp).toLocaleString()}</td>
                <td style={{ padding: "8px", fontFamily: "monospace", fontSize: "0.85em", color: "#e0e0e0" }}>
                  {msg.psid.substring(0, 12)}...
                </td>
                <td style={{ padding: "8px", maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis", color: "white" }}>
                  {msg.text}
                </td>
                <td style={{ padding: "8px", color: msg.senderType === "bot" ? "lightblue" : "white" }}>
                  {msg.senderType}
                </td>
                <td style={{ padding: "8px" }}>
                  {needsHelp ? (
                    <div>
                      <span style={{ color: "#ff5252", fontWeight: "bold" }}>🚨 Necesita Ayuda</span>
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Conversation Detail Modal */}
      {selectedPsid && (
        <div
          onClick={() => setSelectedPsid(null)}
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
              <h3 style={{ margin: 0, color: "white" }}>Conversacion Completa - PSID: {selectedPsid.substring(0, 12)}...</h3>
              <button
                onClick={() => setSelectedPsid(null)}
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
                    backgroundColor: msg.senderType === "bot" ? "#1e3a5f" : "#2a2a2a"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem", fontSize: "0.85rem", color: "#888" }}>
                    <span>{msg.senderType === "bot" ? "🤖 Bot" : "👤 Usuario"}</span>
                    <span>{new Date(msg.timestamp).toLocaleString()}</span>
                  </div>
                  <p style={{ margin: 0, whiteSpace: "pre-wrap", color: "white" }}>{msg.text}</p>
                </div>
              ))}
            </div>

            {/* Footer with handover controls */}
            <div style={{ padding: "1rem", borderTop: "1px solid #2a2a2a", display: "flex", gap: "0.5rem", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.9rem", color: "#888" }}>
                Estado: {conversationStatuses[selectedPsid]?.humanActive ? "👨‍💼 Humano" : "🤖 Bot"}
              </span>
              <div style={{ display: "flex", gap: "0.5rem" }}>
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
                  onClick={() => setSelectedPsid(null)}
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
          </div>
        </div>
      )}
    </div>
  );
}

export default Messages;
