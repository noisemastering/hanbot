// components/Speedometer.js
//
// A car-style speedometer gauge (pure SVG). The needle points at `value` out of a
// dynamic max; the plan `limit` sits at 75% of the dial and the remaining quarter
// is the red "overage" zone — so as you approach and pass the plan the needle
// swings into the redline, just like an RPM gauge.
import React from "react";

const START = -120; // degrees, 0 = top (12 o'clock), sweeping clockwise
const SWEEP = 240;
const toRad = (d) => (d * Math.PI) / 180;
const pt = (cx, cy, r, ang) => ({ x: cx + r * Math.sin(toRad(ang)), y: cy - r * Math.cos(toRad(ang)) });
function arc(cx, cy, r, a1, a2) {
  const p1 = pt(cx, cy, r, a1);
  const p2 = pt(cx, cy, r, a2);
  const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
}

export default function Speedometer({ value = 0, limit = 3000 }) {
  const cx = 160, cy = 158, r = 122, stroke = 20;
  const max = Math.max(limit * (4 / 3), value * 1.05); // limit at ~75% of the dial; grow if over
  const clamp = (v) => Math.min(1, Math.max(0, v / max));
  const angleFor = (v) => START + SWEEP * clamp(v);
  const valAngle = angleFor(value);
  const limitAngle = angleFor(limit);
  const over = value > limit;
  const frac = limit ? value / limit : 0;
  const progColor = over ? "#ef4444" : frac > 0.85 ? "#f59e0b" : "#22c55e";
  const needle = pt(cx, cy, r - 6, valAngle);
  const needleBack = pt(cx, cy, -16, valAngle);

  // ticks (values + short marks)
  const tickVals = [0, limit * 0.25, limit * 0.5, limit * 0.75, limit, max];
  const ticks = tickVals.map((v) => {
    const a = angleFor(v);
    const outer = pt(cx, cy, r + 4, a);
    const inner = pt(cx, cy, r - stroke - 2, a);
    const lbl = pt(cx, cy, r - stroke - 16, a);
    return { v, a, outer, inner, lbl, isLimit: Math.abs(v - limit) < 0.5 };
  });

  return (
    <svg viewBox="0 0 320 210" style={{ width: "100%", maxWidth: 440 }}>
      {/* base track */}
      <path d={arc(cx, cy, r, START, START + SWEEP)} fill="none" stroke="#2a2a2a" strokeWidth={stroke} strokeLinecap="round" />
      {/* redline zone: limit → max */}
      <path d={arc(cx, cy, r, limitAngle, START + SWEEP)} fill="none" stroke="rgba(239,68,68,0.35)" strokeWidth={stroke} />
      {/* progress */}
      {value > 0 && (
        <path d={arc(cx, cy, r, START, valAngle)} fill="none" stroke={progColor} strokeWidth={stroke} strokeLinecap="round" />
      )}
      {/* ticks */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={t.inner.x} y1={t.inner.y} x2={t.outer.x} y2={t.outer.y} stroke={t.isLimit ? "#ef4444" : "#666"} strokeWidth={t.isLimit ? 3 : 1.5} />
          <text x={t.lbl.x} y={t.lbl.y + 4} textAnchor="middle" fontSize="10" fill={t.isLimit ? "#ef4444" : "#888"} fontWeight={t.isLimit ? 700 : 400}>
            {Math.round(t.v).toLocaleString()}
          </text>
        </g>
      ))}
      {/* needle */}
      <line x1={needleBack.x} y1={needleBack.y} x2={needle.x} y2={needle.y} stroke={over ? "#ef4444" : "#e8e8e8"} strokeWidth={3.5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={9} fill="#1a1a1a" stroke={over ? "#ef4444" : "#e8e8e8"} strokeWidth={3} />
      {/* center readout */}
      <text x={cx} y={cy - 34} textAnchor="middle" fontSize="30" fontWeight="800" fill={over ? "#ef4444" : "#fff"}>
        {Math.round(value).toLocaleString()}
      </text>
      <text x={cx} y={cy - 16} textAnchor="middle" fontSize="12" fill="#999">
        / {limit.toLocaleString()} convos
      </text>
    </svg>
  );
}
