// pages/AdWorkflowAssignView.js
//
// Attach a Conversation Workflow to an ad, set its vars, and toggle it on/off
// (super_admin, /playground/anuncio-flujo). When ON, conversations that enter
// through that ad are handled by the router+node engine instead of the legacy
// bot; flipping it OFF reverts the ad's traffic to the current bot on the next
// message. The production-facing Ads page is left untouched.
import React, { useState, useEffect, useMemo } from "react";
import toast from "react-hot-toast";
import API from "../api";
import SetupFields from "../components/workflow/SetupFields";

// A workflow's family/subfamily id list (multi families[] or legacy single family).
function familyIdsOf(wf) {
  if (!wf) return [];
  if (Array.isArray(wf.families) && wf.families.length) {
    return wf.families.filter((f) => f && f.id).map((f) => f.id);
  }
  return wf.family?.id ? [wf.family.id] : [];
}

export default function AdWorkflowAssignView() {
  const [workflows, setWorkflows] = useState([]);
  const [query, setQuery] = useState("");
  const [ads, setAds] = useState([]);
  const [loadingAds, setLoadingAds] = useState(false);
  const [selectedAd, setSelectedAd] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  // Draft attachment for the selected ad.
  const [workflowId, setWorkflowId] = useState("");
  const [setup, setSetup] = useState({});
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load workflows once.
  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/workflows");
        setWorkflows(res.data?.data || []);
      } catch (err) {
        toast.error(err.response?.data?.error || "No se pudieron cargar los workflows");
      }
    })();
  }, []);

  // Search ads (debounced). refreshTick lets us reload after a Facebook re-sync
  // without changing the query.
  useEffect(() => {
    const t = setTimeout(async () => {
      setLoadingAds(true);
      try {
        const res = await API.get("/workflows/ads", { params: { q: query } });
        setAds(res.data?.data || []);
      } catch (err) {
        toast.error(err.response?.data?.error || "No se pudieron cargar los anuncios");
      } finally {
        setLoadingAds(false);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, refreshTick]);

  // Pull fresh campaigns/ad sets/ads from the Facebook Marketing API (reuses the
  // existing sync), then reload the ad list so new/updated ads appear here.
  const reSyncFacebook = async () => {
    setSyncing(true);
    const toastId = toast.loading("Sincronizando con Facebook…");
    try {
      const res = await API.post("/campaigns/sync-facebook");
      const a = res.data?.results?.ads || {};
      toast.success(
        `Facebook sincronizado · anuncios: ${a.created || 0} nuevos, ${a.updated || 0} actualizados`,
        { id: toastId }
      );
      setRefreshTick((t) => t + 1); // reload the list with current query
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo sincronizar con Facebook", { id: toastId });
    } finally {
      setSyncing(false);
    }
  };

  const selectedWorkflow = useMemo(
    () => workflows.find((w) => String(w._id) === String(workflowId)) || null,
    [workflows, workflowId]
  );
  const familyIds = useMemo(() => familyIdsOf(selectedWorkflow), [selectedWorkflow]);

  // Load an ad's current attachment into the draft.
  const selectAd = (ad) => {
    setSelectedAd(ad);
    setWorkflowId(ad.workflowId?._id || ad.workflowId || "");
    setSetup(ad.workflowSetup || {});
    setEnabled(!!ad.workflowEnabled);
  };

  const save = async (overrideEnabled) => {
    if (!selectedAd) return;
    const nextEnabled = overrideEnabled !== undefined ? overrideEnabled : enabled;
    if (nextEnabled && !workflowId) {
      toast.error("Selecciona un workflow antes de activarlo.");
      return;
    }
    setSaving(true);
    try {
      const res = await API.patch(`/workflows/ads/${selectedAd._id}`, {
        workflowId: workflowId || null,
        workflowSetup: setup || null,
        workflowEnabled: nextEnabled,
      });
      const updated = res.data?.data;
      setEnabled(!!updated.workflowEnabled);
      // reflect in the list + selection
      setAds((list) => list.map((a) => (a._id === updated._id ? { ...a, ...updated } : a)));
      setSelectedAd((a) => ({ ...a, ...updated }));
      toast.success(
        nextEnabled
          ? "Workflow ACTIVO en este anuncio · aplica en el próximo mensaje"
          : "Guardado · el anuncio usa el bot actual"
      );
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          Asignar flujo a un anuncio
          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">beta</span>
        </h1>
        <p className="text-gray-400 text-xs mt-0.5">
          Conecta un workflow a un anuncio para probarlo en vivo. Cuando está <b>activo</b>, las
          conversaciones que entran por ese anuncio las atiende el motor de workflows; al
          <b> desactivarlo</b> el anuncio vuelve al bot actual en el siguiente mensaje. No afecta a
          ningún anuncio que no toques aquí.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Ad list */}
        <div className="w-full lg:w-80 shrink-0">
          <button
            onClick={reSyncFacebook}
            disabled={syncing}
            className="w-full mb-2 px-3 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 flex items-center justify-center gap-2"
            title="Trae campañas, conjuntos y anuncios nuevos/actualizados desde Facebook"
          >
            {syncing ? "Sincronizando…" : "↻ Re-sincronizar con Facebook"}
          </button>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar anuncio por nombre o ID…"
            className="wf-input mb-2"
          />
          <div className="border border-gray-700 rounded-xl divide-y divide-gray-800 max-h-[70vh] overflow-y-auto">
            {loadingAds ? (
              <p className="text-gray-500 text-sm p-4">Cargando…</p>
            ) : ads.length === 0 ? (
              <p className="text-gray-500 text-sm p-4">No hay anuncios.</p>
            ) : (
              ads.map((ad) => {
                const on = ad.workflowEnabled && ad.workflowId;
                const isSel = selectedAd?._id === ad._id;
                return (
                  <button
                    key={ad._id}
                    onClick={() => selectAd(ad)}
                    className={`w-full text-left px-3 py-2 hover:bg-gray-800/60 ${isSel ? "bg-gray-800" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${on ? "bg-emerald-400" : "bg-gray-600"}`}
                        title={on ? "Workflow activo" : "Bot actual"}
                      />
                      <span className="text-sm text-white truncate">{ad.name}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 pl-4 truncate">
                      {ad.fbAdId}
                      {ad.workflowId?.name ? ` · ${ad.workflowId.name}` : ""}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Attachment editor */}
        <div className="flex-1 min-w-0">
          {!selectedAd ? (
            <div className="text-gray-500 text-sm border border-gray-700 rounded-xl p-10 text-center">
              Selecciona un anuncio para asignarle un flujo.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="border border-gray-700 rounded-xl p-4 bg-gray-800/40">
                <p className="text-[11px] uppercase text-gray-400">Anuncio</p>
                <p className="text-lg font-semibold text-white">{selectedAd.name}</p>
                <p className="text-[11px] text-gray-500">ID: {selectedAd.fbAdId}</p>
              </div>

              {/* Workflow picker */}
              <div className="border border-gray-700 rounded-xl p-4 bg-gray-800/40">
                <label className="block">
                  <span className="block text-xs text-gray-400 mb-1">Workflow</span>
                  <select
                    className="wf-input"
                    value={workflowId}
                    onChange={(e) => setWorkflowId(e.target.value)}
                  >
                    <option value="">— sin asignar (usa el bot actual) —</option>
                    {workflows.map((w) => (
                      <option key={w._id} value={w._id}>
                        {w.name} {w.active ? "● activo" : "○ inactivo"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Vars */}
              {workflowId && (
                <div className="border border-gray-700 rounded-xl p-4 bg-gray-800/40">
                  <p className="text-xs uppercase text-gray-400 mb-2">
                    Variables del flujo (simulan la asignación del anuncio)
                  </p>
                  <SetupFields value={setup} onChange={setSetup} familyIds={familyIds} />
                </div>
              )}

              {/* Toggle + save */}
              <div className="border border-gray-700 rounded-xl p-4 bg-gray-800/40 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-white font-semibold">
                    Estado:{" "}
                    <span className={enabled ? "text-emerald-300" : "text-gray-400"}>
                      {enabled ? "ACTIVO (motor de workflows)" : "Inactivo (bot actual)"}
                    </span>
                  </p>
                  <p className="text-[11px] text-gray-500">
                    El cambio aplica en el próximo mensaje de cada conversación de este anuncio.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => save(false)}
                    disabled={saving}
                    className="px-3 py-2 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 text-white disabled:opacity-50"
                  >
                    Guardar / Apagar
                  </button>
                  <button
                    onClick={() => save(true)}
                    disabled={saving || !workflowId}
                    className="px-3 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
                  >
                    {saving ? "…" : "Activar"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
