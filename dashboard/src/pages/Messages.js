import React, { useEffect, useState } from "react";
import API from "../api";

function Messages() {
  const [messages, setMessages] = useState([]);
  const [conversationStatuses, setConversationStatuses] = useState({});
  const [loading, setLoading] = useState({});
  const [selectedPsid, setSelectedPsid] = useState(null);
  const [fullConversation, setFullConversation] = useState([]);

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

  return (
    <div>
      <h2>💬 Conversaciones registradas <span style={{ fontSize: "0.7em", color: "#888", marginLeft: "1rem" }}>[v2.0]</span></h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "2rem" }}>
        <thead>
          <tr style={{ backgroundColor: "#1b3a1b", color: "lightgreen" }}>
            <th style={{ padding: "8px", textAlign: "left" }}>Fecha</th>
            <th style={{ padding: "8px", textAlign: "left" }}>PSID</th>
            <th style={{ padding: "8px", textAlign: "left" }}>Último mensaje</th>
            <th style={{ padding: "8px", textAlign: "left" }}>Tipo</th>
            <th style={{ padding: "8px", textAlign: "left" }}>Estado</th>
            <th style={{ padding: "8px", textAlign: "left" }}>Acción</th>
          </tr>
        </thead>
        <tbody>
          {Object.values(latestMessages).map((msg) => {
            const status = conversationStatuses[msg.psid];
            const isHumanActive = status?.humanActive;

            return (
              <tr
                key={msg._id}
                onClick={() => {
                  setSelectedPsid(msg.psid);
                  fetchFullConversation(msg.psid);
                }}
                style={{ borderBottom: "1px solid #2a2a2a", cursor: "pointer" }}
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
                  {isHumanActive ? (
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
                        borderRadius: "4px",
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
                        borderRadius: "4px",
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
              <h3 style={{ margin: 0 }}>Conversacion Completa - PSID: {selectedPsid.substring(0, 12)}...</h3>
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
                  <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{msg.text}</p>
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
                      borderRadius: "4px",
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
                      borderRadius: "4px",
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
                    borderRadius: "4px",
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
