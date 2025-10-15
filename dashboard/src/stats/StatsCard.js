import React from "react";

function StatsCard({ title, value }) {
  return (
    <div style={{
      backgroundColor: "#162816",
      padding: "1.5rem 2rem",
      borderRadius: "10px",
      width: "220px"
    }}>
      <h3 style={{ color: "lightgreen" }}>{title}</h3>
      <p style={{ fontSize: "1.8rem", fontWeight: "bold", marginTop: "1rem" }}>{value}</p>
    </div>
  );
}

export default StatsCard;
