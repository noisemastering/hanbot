import React, { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Rotary knob control — drag or scroll to adjust value.
 * Shows current value centered, with a rotation indicator arc.
 */
export default function KnobControl({
  label,
  value,
  min,
  max,
  step = 1,
  baseline,
  unit = '',
  prefix = '',
  format,
  onChange,
  color = '#6366f1', // indigo
  size = 80
}) {
  const knobRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ y: 0, val: 0 });

  // Normalize value to 0-1 range
  const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)));
  // Arc spans from -135° to +135° (270° total)
  const angle = -135 + normalized * 270;

  // Percentage change from baseline
  const pctChange = baseline != null && baseline !== 0
    ? ((value - baseline) / baseline * 100).toFixed(0)
    : null;

  const displayValue = format
    ? format(value)
    : prefix + (value >= 1000 ? (value / 1000).toFixed(1) + 'k' : Number.isInteger(value) ? value : value.toFixed(1)) + unit;

  const clampAndStep = useCallback((raw) => {
    const stepped = Math.round(raw / step) * step;
    return Math.max(min, Math.min(max, stepped));
  }, [min, max, step]);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setDragging(true);
    dragStart.current = { y: e.clientY, val: value };
  }, [value]);

  const handleMouseMove = useCallback((e) => {
    if (!dragging) return;
    const dy = dragStart.current.y - e.clientY; // up = increase
    const range = max - min;
    const sensitivity = range / 150; // 150px drag = full range
    const newVal = clampAndStep(dragStart.current.val + dy * sensitivity);
    onChange(newVal);
  }, [dragging, max, min, clampAndStep, onChange]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragging, handleMouseMove, handleMouseUp]);

  // Scroll to adjust
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? step : -step;
    onChange(clampAndStep(value + delta));
  }, [value, step, clampAndStep, onChange]);

  // Double-click to reset to baseline
  const handleDoubleClick = useCallback(() => {
    if (baseline != null) onChange(baseline);
  }, [baseline, onChange]);

  const r = (size - 12) / 2;
  const cx = size / 2;
  const cy = size / 2;

  // Arc path from -135° to current angle
  const startAngle = -135;
  const toRad = (deg) => (deg - 90) * Math.PI / 180;
  const arcStart = {
    x: cx + r * Math.cos(toRad(startAngle)),
    y: cy + r * Math.sin(toRad(startAngle))
  };
  const arcEnd = {
    x: cx + r * Math.cos(toRad(angle)),
    y: cy + r * Math.sin(toRad(angle))
  };
  const largeArc = (angle - startAngle) > 180 ? 1 : 0;

  // Indicator dot position
  const dotX = cx + (r - 2) * Math.cos(toRad(angle));
  const dotY = cy + (r - 2) * Math.sin(toRad(angle));

  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        ref={knobRef}
        width={size}
        height={size}
        className={`cursor-grab select-none ${dragging ? 'cursor-grabbing' : ''}`}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        style={{ touchAction: 'none' }}
      >
        {/* Background track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#374151" strokeWidth={5}
          strokeDasharray={`${r * Math.PI * 1.5} ${r * Math.PI * 0.5}`}
          strokeDashoffset={r * Math.PI * 0.25}
          strokeLinecap="round"
        />
        {/* Active arc */}
        {normalized > 0.01 && (
          <path
            d={`M ${arcStart.x} ${arcStart.y} A ${r} ${r} 0 ${largeArc} 1 ${arcEnd.x} ${arcEnd.y}`}
            fill="none"
            stroke={color}
            strokeWidth={5}
            strokeLinecap="round"
            opacity={0.9}
          />
        )}
        {/* Indicator dot */}
        <circle cx={dotX} cy={dotY} r={4} fill={color} />
        {/* Center value */}
        <text x={cx} y={cy - 2} textAnchor="middle" dominantBaseline="middle"
          fill="white" fontSize={size < 70 ? 10 : 12} fontWeight="600" fontFamily="monospace">
          {displayValue}
        </text>
        {/* Change indicator */}
        {pctChange != null && Number(pctChange) !== 0 && (
          <text x={cx} y={cy + 14} textAnchor="middle" dominantBaseline="middle"
            fill={Number(pctChange) > 0 ? '#4ade80' : '#f87171'} fontSize={9} fontFamily="sans-serif">
            {Number(pctChange) > 0 ? '+' : ''}{pctChange}%
          </text>
        )}
      </svg>
      <span className="text-xs text-gray-400 text-center leading-tight max-w-[90px]">{label}</span>
    </div>
  );
}
