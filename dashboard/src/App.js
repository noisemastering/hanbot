import React, { useEffect, useState } from "react";
import io from "socket.io-client";
import {
  ResponsiveContainer,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Bar
} from "recharts";

import "./App.css";

// --- Configuración del WebSocket ---
const socket = io("http://localhost:3000");

function playPopSound() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  gain.gain.setValueAtTime(0.15, ctx.currentTime);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.08);
}

function App() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  // --- Cargar mensajes iniciales ---
  const fetchMessages = async () => {
    try {
      const res = await fetch("http://localhost:3000/messages", {
        headers: { Authorization: "Bearer hanlob_admin_2025" }
      });
      const data = await res.json();
      setMessages(data.data || []);
    } catch (error) {
      console.error("❌ Error fetching messages:", error);
    } finally {
      setLoading(false);
    }
  };

  // --- Inicializa conexión y escucha eventos ---
  useEffect(() => {
    fetchMessages();

    socket.on("new_message", (msg) => {
      setMessages((prev) => [msg, ...prev]);
      playPopSound();
    });

    return () => socket.disconnect();
  }, []);

  // --- Cálculo de métricas ---
  const totalMessages = messages.length;
  const totalUsers = new Set(messages.map((m) => m.psid)).size;
  const userMessages = messages.filter((m) => m.senderType === "user").length;
  const botMessages = messages.filter((m) => m.senderType === "bot").length;
  const botResponseRate = totalMessages
    ? ((botMessages / totalMessages) * 100).toFixed(1)
    : 0;

  // --- Mensajes sin respuesta ---
  const lastMessagesByUser = {};
  messages.forEach((m) => {
    if (!lastMessagesByUser[m.psid]) lastMessagesByUser[m.psid] = m;
  });
  const unanswered = Object.values(lastMessagesByUser).filter(
    (m) => m.senderType === "user"
  ).length;

  // --- Filtro de vista ---
  const filteredMessages =
    filter === "all"
      ? messages
      : messages.filter((msg) => msg.senderType === filter);


  // --- Agrupa mensajes por hora ---
function getChartData(messages) {
  const counts = {};

  messages.forEach((m) => {
    const date = new Date(m.timestamp);
    const hour = date.getHours();
    counts[hour] = (counts[hour] || 0) + 1;
  });

  return Object.entries(counts).map(([hour, count]) => ({
    hour: `${hour}:00`,
    count
  }));
}

      
  return (
    <div className="app-container">
      <h1>💬 Hanlob Chatbot Dashboard</h1>

      {/* 📊 MÉTRICAS EN TIEMPO REAL */}
      <div className="stats-container">
        <div className="stat-card">
          <h3>{totalMessages}</h3>
          <p>Mensajes totales</p>
        </div>
        <div className="stat-card">
          <h3>{totalUsers}</h3>
          <p>Usuarios únicos</p>
        </div>
        <div className="stat-card">
          <h3>{botResponseRate}%</h3>
          <p>Tasa de respuesta del bot</p>
        </div>
        <div className="stat-card warning">
          <h3>{unanswered}</h3>
          <p>Sin respuesta</p>
        </div>
      </div>

        {/* 📈 GRÁFICO DE ACTIVIDAD */}
        <div className="chart-container">
          <h2>📊 Actividad reciente</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={getChartData(messages)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#0f5132" />
            </BarChart>
          </ResponsiveContainer>
        </div>

      {/* FILTROS */}
      <div className="filter-buttons">
        <button
          onClick={() => setFilter("all")}
          className={filter === "all" ? "active" : ""}
        >
          Todos
        </button>
        <button
          onClick={() => setFilter("user")}
          className={filter === "user" ? "active" : ""}
        >
          Usuario
        </button>
        <button
          onClick={() => setFilter("bot")}
          className={filter === "bot" ? "active" : ""}
        >
          Bot
        </button>
      </div>

      {/* TABLA DE MENSAJES */}
      {loading ? (
        <p>Cargando mensajes...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>PSID</th>
              <th>Texto</th>
            </tr>
          </thead>
          <tbody>
            {filteredMessages.map((msg) => (
              <tr key={msg._id}>
                <td>{new Date(msg.timestamp).toLocaleString()}</td>
                <td className={msg.senderType}>{msg.senderType}</td>
                <td>{msg.psid}</td>
                <td>{msg.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default App;
