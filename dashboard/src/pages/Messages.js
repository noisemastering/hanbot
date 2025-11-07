import React, { useEffect, useState } from "react";
import API from "../api";

function Messages() {
  const [messages, setMessages] = useState([]);
  const [conversationStatuses, setConversationStatuses] = useState({});
  const [loading, setLoading] = useState({});

  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const res = await API.get("/messages");
        setMessages(res.data.data);

        // Fetch status for each unique PSID
        const uniquePSIDs = [...new Set(res.data.data.map(m => m.psid))];
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
      <h2>💬 Conversaciones registradas</h2>
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
              <tr key={msg._id} style={{ borderBottom: "1px solid #2a2a2a" }}>
                <td style={{ padding: "8px" }}>{new Date(msg.timestamp).toLocaleString()}</td>
                <td style={{ padding: "8px", fontFamily: "monospace", fontSize: "0.85em" }}>
                  {msg.psid.substring(0, 12)}...
                </td>
                <td style={{ padding: "8px", maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis" }}>
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
                      onClick={() => handleRelease(msg.psid)}
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
                      onClick={() => handleTakeover(msg.psid)}
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
    </div>
  );
}

export default Messages;
