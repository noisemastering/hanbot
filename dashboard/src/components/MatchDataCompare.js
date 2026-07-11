// components/MatchDataCompare.js
//
// Side-by-side of the identity data the correlation actually compared: what the
// CONVERSATION gave us vs what MERCADO LIBRE returned on the sale. The ML side is
// highlighted green on the fields that actually matched (so you see WHY it scored).
import React from "react";

export default function MatchDataCompare({ md, saleItemTitle, signals }) {
  if (!md) return <span className="text-gray-600 text-xs">—</span>;
  const s = signals || {};
  const gap =
    md.gapHoursToSale == null ? null
      : md.gapHoursToSale < 1 ? `${Math.round(md.gapHoursToSale * 60)} min` : `${md.gapHoursToSale} h`;

  const Row = ({ label, convo, ml, hit }) => (
    <div className="grid grid-cols-[52px_1fr_1fr] gap-1 items-baseline">
      <span className="text-[9px] uppercase text-gray-500">{label}</span>
      <span className="text-[11px] text-gray-300 truncate" title={convo || ""}>{convo || "—"}</span>
      <span className={`text-[11px] truncate ${hit ? "text-emerald-400 font-medium" : "text-gray-400"}`} title={ml || ""}>{ml || "—"}</span>
    </div>
  );

  return (
    <div className="min-w-[230px]">
      <div className="grid grid-cols-[52px_1fr_1fr] gap-1 mb-0.5">
        <span />
        <span className="text-[9px] uppercase text-gray-500">Convo</span>
        <span className="text-[9px] uppercase text-blue-400">ML (venta)</span>
      </div>
      <Row label="Nombre" convo={md.convoName} ml={md.saleReceiverName || md.saleBuyerName} hit={s.name || s.nickname} />
      <Row label="CP" convo={md.convoZip} ml={md.saleZip} hit={s.zip} />
      <Row label="Ciudad" convo={md.convoCity} ml={md.saleCity} hit={s.city} />
      <Row label="Producto" convo={s.item ? "misma medida" : "—"} ml={saleItemTitle} hit={s.item} />
      <Row label="Usuario" convo="—" ml={md.saleNickname} hit={s.nickname} />
      {gap && <div className="text-[10px] text-gray-500 mt-0.5">Δ clic → venta: {gap}</div>}
    </div>
  );
}
