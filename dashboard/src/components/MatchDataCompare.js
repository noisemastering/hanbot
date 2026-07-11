// components/MatchDataCompare.js
//
// Side-by-side of the identity data the correlation actually compared: what the
// CHAT gave us vs what MERCADO LIBRE returned on the sale. The ML side is
// highlighted green on the fields that actually matched (so you see WHY it scored).
// `large` renders the big-font variant used inside the modal.
import React from "react";

export default function MatchDataCompare({ md, saleItemTitle, signals, large }) {
  if (!md) return <span className="text-gray-600 text-xs">—</span>;
  const s = signals || {};
  const gap =
    md.gapHoursToSale == null ? null
      : md.gapHoursToSale < 1 ? `${Math.round(md.gapHoursToSale * 60)} min` : `${md.gapHoursToSale} h`;
  // What the conversation was about: the discussed size(s), else the product line.
  const convoProduct =
    (md.convoSizes && md.convoSizes.length && md.convoSizes.join(", ")) || md.convoProduct ||
    (s.item ? "misma medida" : null);

  // Compact (panel) vs large (modal, ~80% bigger fonts).
  const fLabel = large ? "text-[16px]" : "text-[9px]";
  const fVal = large ? "text-[20px]" : "text-[11px]";
  const fGap = large ? "text-[18px]" : "text-[10px]";
  const cols = large ? "grid-cols-[120px_1fr_1fr]" : "grid-cols-[52px_1fr_1fr]";
  const colGap = large ? "gap-4" : "gap-1";
  const rowSpace = large ? "space-y-2" : "";

  const Row = ({ label, convo, ml, hit }) => (
    <div className={`grid ${cols} ${colGap} items-baseline`}>
      <span className={`${fLabel} uppercase text-gray-500`}>{label}</span>
      <span className={`${fVal} text-gray-300 truncate`} title={convo || ""}>{convo || "—"}</span>
      <span className={`${fVal} truncate ${hit ? "text-emerald-400 font-medium" : "text-gray-400"}`} title={ml || ""}>{ml || "—"}</span>
    </div>
  );

  return (
    <div className={`${large ? "min-w-[520px]" : "min-w-[230px]"} ${rowSpace}`}>
      <div className={`grid ${cols} ${colGap} mb-0.5`}>
        <span />
        <span className={`${fLabel} uppercase text-gray-500`}>Chat</span>
        <span className={`${fLabel} uppercase text-blue-400`}>ML (venta)</span>
      </div>
      <Row label="Nombre" convo={md.convoName} ml={md.saleReceiverName || md.saleBuyerName} hit={s.name || s.nickname} />
      <Row label="CP" convo={md.convoZip} ml={md.saleZip} hit={s.zip} />
      <Row label="Ciudad" convo={md.convoCity} ml={md.saleCity} hit={s.city} />
      <Row label="Producto" convo={convoProduct} ml={md.saleProduct || saleItemTitle} hit={s.item} />
      <Row label="Usuario" convo="—" ml={md.saleNickname} hit={s.nickname} />
      {gap && <div className={`${fGap} text-gray-500 mt-0.5`}>Δ clic → venta: {gap}</div>}
    </div>
  );
}
