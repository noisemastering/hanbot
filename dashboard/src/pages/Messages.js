import React, { useEffect, useState } from "react";
import API from "../api";

function Messages() {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const res = await API.get("/messages");
        setMessages(res.data.data);
      } catch (err) {
        console.error(err);
      }
    };
    fetchMessages();
  }, []);

  return (
    <div>
      <h2>💬 Conversaciones registradas</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "2rem" }}>
        <thead>
          <tr style={{ backgroundColor: "#1b3a1b", color: "lightgreen" }}>
            <th style={{ padding: "8px", textAlign: "left" }}>Fecha</th>
            <th style={{ padding: "8px", textAlign: "left" }}>PSID</th>
            <th style={{ padding: "8px", textAlign: "left" }}>Mensaje</th>
            <th style={{ padding: "8px", textAlign: "left" }}>Tipo</th>
          </tr>
        </thead>
        <tbody>
          {messages.map((msg) => (
            <tr key={msg._id} style={{ borderBottom: "1px solid #2a2a2a" }}>
              <td style={{ padding: "8px" }}>{new Date(msg.timestamp).toLocaleString()}</td>
              <td style={{ padding: "8px" }}>{msg.psid}</td>
              <td style={{ padding: "8px" }}>{msg.text}</td>
              <td style={{ padding: "8px", color: msg.senderType === "bot" ? "lightblue" : "white" }}>
                {msg.senderType}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default Messages;
