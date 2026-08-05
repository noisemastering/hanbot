// components/MexicoMap.js
//
// A Mexico states choropleth (pure SVG, no map library). Loads a bundled states
// GeoJSON (public/geo) + per-state counts from /geo/by-state, projects lon/lat with
// a simple cos-corrected equirectangular projection (accurate enough for a country
// choropleth, zero extra deps), colors each state by its count, and shows a hover
// tooltip + legend. Click a state → onSelectState(name) for a future drill-down.
import React, { useEffect, useMemo, useRef, useState } from "react";
import API from "../api";

// Normalize a state name for matching (lowercase, strip accents) + aliases where
// our sales data and the GeoJSON disagree.
const strip = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const ALIAS = {
  "distrito federal": "ciudad de mexico",
  "estado de mexico": "mexico",
  "cdmx": "ciudad de mexico",
  // Official INEGI long names (from the ZipCode table) → GeoJSON short names.
  "coahuila de zaragoza": "coahuila",
  "michoacan de ocampo": "michoacan",
  "veracruz de ignacio de la llave": "veracruz",
};
const keyOf = (name) => { const k = strip(name); return ALIAS[k] || k; };

const W = 900, H = 560, PAD = 12;

export default function MexicoMap({ metric = "sales", onSelectState }) {
  const [geo, setGeo] = useState(null);
  const [counts, setCounts] = useState({});
  const [hover, setHover] = useState(null); // { name, count, x, y }
  const wrapRef = useRef(null);

  useEffect(() => {
    fetch("/geo/mexicoStates.json").then((r) => r.json()).then(setGeo).catch(() => {});
  }, []);
  useEffect(() => {
    // Guard against out-of-order responses: the `sales` aggregation (103k docs) is
    // slower than `conversations`, so a stale earlier response could overwrite the
    // current one ("one click behind"). Only apply the response if this effect run
    // is still the active one AND the server echoed back the metric we asked for.
    let active = true;
    setCounts({}); // clear immediately so the map can't show the previous metric's data
    API.get(`/geo/by-state?metric=${metric}`).then((r) => {
      if (!active || !r.data.success || r.data.metric !== metric) return;
      const m = {};
      for (const row of r.data.data) m[keyOf(row.state)] = row.count;
      setCounts(m);
    }).catch(() => {});
    return () => { active = false; };
  }, [metric]);

  // Projection: bbox over all coords → cos-corrected equirectangular fit to the viewBox.
  const project = useMemo(() => {
    if (!geo) return null;
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    const eachCoord = (g, fn) => {
      const walk = (a) => { if (typeof a[0] === "number") fn(a); else a.forEach(walk); };
      walk(g.coordinates);
    };
    geo.features.forEach((f) => eachCoord(f.geometry, ([lon, lat]) => {
      if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    }));
    const midLat = (minLat + maxLat) / 2;
    const cos = Math.cos((midLat * Math.PI) / 180);
    const xSpan = (maxLon - minLon) * cos, ySpan = maxLat - minLat;
    const scale = Math.min((W - 2 * PAD) / xSpan, (H - 2 * PAD) / ySpan);
    const offX = (W - xSpan * scale) / 2, offY = (H - ySpan * scale) / 2;
    return ([lon, lat]) => [offX + (lon - minLon) * cos * scale, offY + (maxLat - lat) * scale];
  }, [geo]);

  const paths = useMemo(() => {
    if (!geo || !project) return [];
    const ring = (r) => "M" + r.map((p) => { const [x, y] = project(p); return `${x.toFixed(1)},${y.toFixed(1)}`; }).join("L") + "Z";
    return geo.features.map((f) => {
      const g = f.geometry;
      const polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
      const d = polys.map((poly) => poly.map(ring).join(" ")).join(" ");
      return { name: f.properties.name, d, count: counts[keyOf(f.properties.name)] || 0 };
    });
  }, [geo, project, counts]);

  const max = useMemo(() => Math.max(1, ...paths.map((p) => p.count)), [paths]);

  // color ramp: slate (low) → green (high), sqrt-scaled for the skewed distribution.
  const color = (c) => {
    if (!c) return "#2a2f3a";
    const t = Math.sqrt(c / max);
    const lo = [30, 41, 59], hi = [34, 197, 94];
    const mix = lo.map((v, i) => Math.round(v + (hi[i] - v) * t));
    return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
  };

  const onMove = (e, p) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    setHover({ name: p.name, count: p.count, x: e.clientX - (rect?.left || 0), y: e.clientY - (rect?.top || 0) });
  };

  if (!geo) return <div className="text-gray-500 p-8 text-center">Cargando mapa…</div>;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
        {paths.map((p) => (
          <path
            key={p.name}
            d={p.d}
            fill={color(p.count)}
            stroke={hover?.name === p.name ? "#fff" : "#11151c"}
            strokeWidth={hover?.name === p.name ? 1.5 : 0.6}
            style={{ cursor: onSelectState ? "pointer" : "default", transition: "fill 0.15s" }}
            onMouseMove={(e) => onMove(e, p)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelectState && onSelectState(p.name)}
          />
        ))}
      </svg>

      {hover && (
        <div style={{ position: "absolute", left: hover.x + 12, top: hover.y + 12, pointerEvents: "none", background: "#0f1117", border: "1px solid #333", borderRadius: 8, padding: "6px 10px", fontSize: 13, color: "#fff", whiteSpace: "nowrap", zIndex: 5, boxShadow: "0 4px 16px rgba(0,0,0,0.5)" }}>
          <div style={{ fontWeight: 600 }}>{hover.name}</div>
          <div style={{ color: "#9ae6b4" }}>{hover.count.toLocaleString("es-MX")} {metric === "sales" ? "ventas" : "convos"}</div>
        </div>
      )}

      {/* legend */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: "#888" }}>
        <span>0</span>
        <div style={{ width: 160, height: 10, borderRadius: 5, background: "linear-gradient(90deg, #2a2f3a, rgb(30,41,59), rgb(34,197,94))" }} />
        <span>{max.toLocaleString("es-MX")}</span>
      </div>
    </div>
  );
}
