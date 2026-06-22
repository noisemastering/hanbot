// pages/NukeEmView.js
//
// Spec Ops · Nuke'em (super_admin). Hard offline lockdown: the entire API returns
// 503 for everyone (except auth + spec-ops so super_admin can recover) and the bot
// is dead on every channel. The deployment and the GitHub code are NOT touched —
// fully reversible. Arming requires the super_admin password + the two-part secret.
import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import API from "../api";

export default function NukeEmView() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [secretWord, setSecretWord] = useState("");
  const [secretCode, setSecretCode] = useState("");
  const [armed, setArmed] = useState(false); // showing the final confirm gate

  const load = async () => {
    try {
      const res = await API.get("/spec-ops/status");
      setStatus(res.data);
    } catch (e) {
      toast.error("No se pudo leer el estado");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const engaged = !!status?.nuke?.engaged;

  const fire = async () => {
    setBusy(true);
    try {
      const res = await API.post("/spec-ops/nuke", { engage: true, password, secretWord, secretCode });
      setStatus(res.data);
      setArmed(false); setPassword(""); setSecretWord(""); setSecretCode("");
      toast.error("☢️ NUKE'EM ENGAGED — sistema fuera de servicio");
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo ejecutar Nuke'em");
    } finally {
      setBusy(false);
    }
  };

  const recover = async () => {
    if (!password) { toast.error("Ingresa tu contraseña para recuperar"); return; }
    setBusy(true);
    try {
      const res = await API.post("/spec-ops/nuke", { engage: false, password });
      setStatus(res.data);
      setPassword("");
      toast.success("Sistema en línea de nuevo");
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo recuperar");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="p-8 text-gray-400">Cargando…</div>;

  const canFire = password && secretWord && secretCode;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">☢️ Nuke'em</h1>
      <p className="text-gray-400 mb-2">
        Apaga <strong>TODO</strong>: la API completa responde fuera de servicio para todos y el bot queda muerto en
        todos los canales. Funcionalmente "des-desplegado".
      </p>
      <p className="text-xs text-gray-500 mb-6">
        El despliegue y el código en GitHub <strong>NO se tocan</strong> — es reversible: un super admin puede recuperar
        el sistema desde aquí con su contraseña.
      </p>

      {engaged ? (
        <div className="rounded-2xl border border-red-500 bg-red-950/40 p-8 text-center">
          <p className="text-red-300 font-bold text-lg mb-1">SISTEMA FUERA DE SERVICIO</p>
          {status?.nuke?.at && (
            <p className="text-xs text-gray-500 mb-5">
              Activado {new Date(status.nuke.at).toLocaleString()} {status.nuke.by ? `por ${status.nuke.by}` : ""}
            </p>
          )}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Tu contraseña para recuperar"
            className="w-full max-w-xs mx-auto block bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm mb-3"
          />
          <button onClick={recover} disabled={busy} className="px-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-50">
            {busy ? "Recuperando…" : "Recuperar sistema"}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-700 bg-gray-800/40 p-6 space-y-3">
          <label className="block text-xs text-gray-400">Contraseña de super admin</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm" />
          <label className="block text-xs text-gray-400">Código secreto · palabra</label>
          <input type="password" value={secretWord} onChange={(e) => setSecretWord(e.target.value)} autoComplete="off"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm" />
          <label className="block text-xs text-gray-400">Código secreto · número</label>
          <input type="password" value={secretCode} onChange={(e) => setSecretCode(e.target.value)} autoComplete="off"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm" />

          {!armed ? (
            <button onClick={() => setArmed(true)} disabled={!canFire}
              className="w-full mt-2 px-6 py-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-lg font-extrabold disabled:opacity-40 disabled:cursor-not-allowed">
              ARMAR NUKE'EM
            </button>
          ) : (
            <div className="mt-2 space-y-3 text-center">
              <p className="text-red-300 font-bold">Esto apagará TODO el sistema. ¿Confirmas?</p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => setArmed(false)} className="px-5 py-2.5 rounded-lg bg-gray-700 text-white">Cancelar</button>
                <button onClick={fire} disabled={busy} className="px-6 py-3 rounded-lg bg-red-700 hover:bg-red-600 text-white font-extrabold disabled:opacity-50">
                  {busy ? "Ejecutando…" : "☢️ EJECUTAR NUKE'EM"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
