// components/workflow/AdSandboxPicker.js
//
// "Test this ad" for the sandbox. Instead of picking a flow and then hand-
// building the promo/product setup to match it, pick the AD and the system
// pulls the config already attached to it.
//
// This is not a convenience layer over the manual pickers — it is the same
// resolution production does. An ad-routed conversation is seeded with
// initState(ad.workflowId, {}, ad.workflowSetup) (ai/index.js
// maybeRunAdWorkflow), and the sandbox seeds its session the same way from the
// same two fields. So whatever a tester sees here is what that ad's traffic
// gets, and a hand-built setup that merely resembles the ad is no longer the
// only option.
//
// Only ads WITH a flow attached can be simulated (?attached=1) — an ad without
// one has no config to pull, and in production it would not reach the engine
// through this path at all.
import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import API from "../../api";

const BUYER = { end_user: "Consumidor final", reseller: "Revendedor" };
const TONE = { casual: "Casual", professional: "Profesional", technical: "Técnico" };
const PURCHASE = { retail: "Menudeo", wholesale: "Mayoreo" };
const CHANNEL = { marketplace: "Marketplace", manual: "Manual (asesor)" };

const STATUS_STYLE = {
  ACTIVE: "bg-emerald-900/50 text-emerald-300 border-emerald-700/50",
  PAUSED: "bg-amber-900/40 text-amber-300 border-amber-700/50",
  DELETED: "bg-red-900/40 text-red-300 border-red-700/50",
  ARCHIVED: "bg-gray-700/50 text-gray-300 border-gray-600/50",
};

function Chip({ children, className = "" }) {
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded border ${className}`}>{children}</span>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-gray-500 w-28 shrink-0">{label}</span>
      <span className="text-gray-200 min-w-0">{children}</span>
    </div>
  );
}

/**
 * @param {string} value            selected ad id
 * @param {(id: string) => void} onChange
 * @param {(cfg: object|null) => void} onConfig  resolved config for the selected ad
 */
export default function AdSandboxPicker({ value, onChange, onConfig }) {
  const [ads, setAds] = useState([]);
  const [loadingAds, setLoadingAds] = useState(true);
  const [config, setConfig] = useState(null);
  const [loadingCfg, setLoadingCfg] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/workflows/ads", { params: { attached: 1 } });
        setAds(res.data?.data || []);
      } catch (err) {
        toast.error(err.response?.data?.error || "No se pudieron cargar los anuncios");
      } finally {
        setLoadingAds(false);
      }
    })();
  }, []);

  // Pull the ad's attached config whenever the selection changes.
  useEffect(() => {
    if (!value) {
      setConfig(null);
      onConfig?.(null);
      return;
    }
    let alive = true;
    setLoadingCfg(true);
    (async () => {
      try {
        const res = await API.get(`/workflows/ads/${value}/sandbox-config`);
        if (!alive) return;
        const cfg = res.data?.data || null;
        setConfig(cfg);
        onConfig?.(cfg);
      } catch (err) {
        if (!alive) return;
        setConfig(null);
        onConfig?.(null);
        toast.error(err.response?.data?.error || "No se pudo cargar la configuración del anuncio");
      } finally {
        if (alive) setLoadingCfg(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const s = config?.summary;

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-gray-400 mb-1">Anuncio a probar</label>
        <select
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={loadingAds}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
        >
          <option value="">
            {loadingAds ? "cargando anuncios…" : ads.length ? "— selecciona un anuncio —" : "— no hay anuncios con flujo asignado —"}
          </option>
          {ads.map((a) => (
            <option key={a._id} value={a._id}>
              {a.name} · {a.workflowId?.name || "sin flujo"}
              {a.status !== "ACTIVE" ? ` (${a.status})` : ""}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-gray-500 mt-1">
          Se cargan el flujo, la promoción y los productos que ya tiene asignados el anuncio — lo mismo que recibe
          una conversación que entra por él.
        </p>
      </div>

      {loadingCfg && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="inline-block w-3.5 h-3.5 border-2 border-gray-600 border-t-sky-400 rounded-full animate-spin" />
          Cargando la configuración del anuncio…
        </div>
      )}

      {config && !loadingCfg && (
        <div className="border border-sky-800/50 bg-sky-950/20 rounded-xl p-3 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-white">{config.ad.name}</span>
            <Chip className={STATUS_STYLE[config.ad.status] || STATUS_STYLE.ARCHIVED}>{config.ad.status}</Chip>
            {config.ad.workflowEnabled ? (
              <Chip className="bg-emerald-900/40 text-emerald-300 border-emerald-700/50">bot activo</Chip>
            ) : (
              <Chip className="bg-gray-700/50 text-gray-300 border-gray-600/50">bot apagado en este anuncio</Chip>
            )}
            <span className="text-[11px] text-gray-500">id {config.ad.fbAdId}</span>
          </div>

          <Row label="Flujo">
            {config.workflow.name}
            {!config.workflow.active && <span className="text-amber-400"> · inactivo</span>}
          </Row>

          {s?.empty ? (
            <p className="text-xs text-amber-400">
              Este anuncio no tiene configuración guardada: el flujo corre con sus valores por defecto (es
              exactamente lo que pasa en producción).
            </p>
          ) : (
            <>
              <Row label="Productos">
                {s.products.length
                  ? s.products.map((p) => `${p.name}${p.kind === "family" ? " (grupo)" : ""}`).join(", ")
                  : "— todos los de la familia del flujo —"}
              </Row>
              <Row label="Promoción">
                {s.promo ? (
                  <>
                    {s.promo.name}
                    {!s.promo.active && <span className="text-amber-400"> · inactiva</span>}
                  </>
                ) : (
                  "— sin promo —"
                )}
              </Row>
              <Row label="Cliente / tono">
                {[BUYER[s.buyer] || s.buyer, TONE[s.tone] || s.tone].filter(Boolean).join(" · ") || "—"}
              </Row>
              <Row label="Compra / canal">
                {[PURCHASE[s.purchaseType] || s.purchaseType, CHANNEL[s.saleChannel] || s.saleChannel]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </Row>
              {s.altMarketplace && (
                <Row label="Marketplace alt.">
                  {s.altMarketplace.name}
                  {s.altMarketplace.productCount > 0 && ` · ${s.altMarketplace.productCount} producto(s)`}
                </Row>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
