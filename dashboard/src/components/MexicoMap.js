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
const UNIT = { ml: "ventas ML", ventas: "ventas", conversations: "convos", clicks: "personas" };
// Thermometer scale stops (p = position 0..1 on the sqrt-scaled value, c = [r,g,b]).
const STOPS = [
  { p: 0.0, c: [59, 130, 246] },   // blue   — cold / low
  { p: 0.35, c: [34, 197, 94] },   // green
  { p: 0.6, c: [234, 179, 8] },    // yellow
  { p: 0.8, c: [249, 115, 22] },   // orange
  { p: 1.0, c: [239, 68, 68] },    // red    — hot / high
];
const RAMP_CSS = "linear-gradient(90deg, #2a2f3a, rgb(59,130,246), rgb(34,197,94), rgb(234,179,8), rgb(249,115,22), rgb(239,68,68))";

export default function MexicoMap({ metric = "sales", onSelectState }) {
  const [geo, setGeo] = useState(null);
  const [counts, setCounts] = useState({});
  const [hover, setHover] = useState(null); // { name, count, x, y }
  const [loading, setLoading] = useState(false);
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
    // Keep the previous metric's colors visible until the new data lands (no fade to
    // gray) — easier to eyeball the difference. The guards below still prevent a stale
    // response from overwriting the current one.
    setLoading(true);
    API.get(`/geo/by-state?metric=${metric}`).then((r) => {
      if (!active || !r.data.success || r.data.metric !== metric) return;
      const m = {};
      for (const row of r.data.data) m[keyOf(row.state)] = row.count;
      setCounts(m);
    }).catch(() => {}).finally(() => { if (active) setLoading(false); });
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

  // Thermometer color ramp: blue (cold/low) → green → yellow → orange → red (hot/high),
  // sqrt-scaled for the skewed distribution so mid-values are readable.
  const color = (c) => {
    if (!c) return "#2a2f3a"; // no data → neutral gray
    const t = Math.sqrt(c / max);
    let lo = STOPS[0], hi = STOPS[STOPS.length - 1];
    for (let i = 0; i < STOPS.length - 1; i++) {
      if (t >= STOPS[i].p && t <= STOPS[i + 1].p) { lo = STOPS[i]; hi = STOPS[i + 1]; break; }
    }
    const f = hi.p === lo.p ? 0 : (t - lo.p) / (hi.p - lo.p);
    const mix = lo.c.map((v, i) => Math.round(v + (hi.c[i] - v) * f));
    return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
  };

  const onMove = (e, p) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    setHover({ name: p.name, count: p.count, x: e.clientX - (rect?.left || 0), y: e.clientY - (rect?.top || 0) });
  };

  if (!geo) return <div className="text-gray-500 p-8 text-center">Cargando mapa…</div>;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      {loading && (
        <div style={{ position: "absolute", top: 10, right: 10, display: "flex", alignItems: "center", gap: 8, background: "rgba(15,17,23,0.85)", border: "1px solid #333", borderRadius: 8, padding: "6px 12px", fontSize: 12, color: "#cbd5e1", zIndex: 6 }}>
          <span style={{ width: 14, height: 14, border: "2px solid #4a7cff", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "mmspin 0.7s linear infinite" }} />
          Cargando…
          <style>{`@keyframes mmspin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", opacity: loading ? 0.6 : 1, transition: "opacity 0.2s" }}>
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
          <div style={{ color: "#9ae6b4" }}>{hover.count.toLocaleString("es-MX")} {UNIT[metric] || ""}</div>
        </div>
      )}

      {/* legend */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: "#888" }}>
        <span>0</span>
        <div style={{ width: 220, height: 10, borderRadius: 5, background: RAMP_CSS }} />
        <span>{max.toLocaleString("es-MX")}</span>
      </div>
    </div>
  );
}
