import React from "react";
import StatsCard from "../components/StatsCard";

function Home() {
  return (
    <div>
      <h2>📈 Resumen general</h2>
      <div style={{ display: "flex", gap: "2rem", marginTop: "2rem" }}>
        <StatsCard title="Mensajes totales" value="—" />
        <StatsCard title="Usuarios únicos" value="—" />
        <StatsCard title="Tasa de respuesta" value="—" />
      </div>
      <p style={{ marginTop: "3rem", color: "#aaa" }}>
        Aquí verás estadísticas generales de interacción una vez que conectemos los datos.
      </p>
    </div>
  );
}

export default Home;
