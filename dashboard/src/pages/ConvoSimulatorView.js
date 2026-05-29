// pages/ConvoSimulatorView.js
//
// Standalone conversation simulator (super_admin, /playground/simulador).
// Pick a workflow and chat against the router+node engine in the sandbox.
// The full authoring studio lives separately under Playground → Workflows.
import React, { useState, useEffect } from "react";
import toast from "react-hot-toast";
import API from "../api";
import SandboxTester from "../components/workflow/SandboxTester";

function ConvoSimulatorView() {
  const [workflows, setWorkflows] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await API.get("/workflows");
        const list = res.data?.data || [];
        setWorkflows(list);
        if (list.length) setSelectedId((prev) => prev || list[0]._id);
      } catch (err) {
        toast.error(err.response?.data?.error || "No se pudieron cargar los workflows");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            Simulador de conversación
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">beta</span>
          </h1>
          <p className="text-gray-400 text-xs mt-0.5">
            Prueba un workflow (motor router+nodo) en un chat sandbox. No afecta al bot en producción.
          </p>
        </div>
        <div className="flex-1" />
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm min-w-[240px]"
        >
          <option value="">— selecciona un workflow —</option>
          {workflows.map((w) => (
            <option key={w._id} value={w._id}>
              {w.name} {w.active ? "● activo" : "○ inactivo"}
            </option>
          ))}
        </select>
      </div>

      {!selectedId ? (
        <div className="text-gray-500 text-sm border border-gray-700 rounded-xl p-10 text-center">
          {loading
            ? "Cargando workflows…"
            : workflows.length
            ? "Selecciona un workflow para simular."
            : "No hay workflows. Crea uno en Playground → Workflows."}
        </div>
      ) : (
        <SandboxTester workflowId={selectedId} dirty={false} />
      )}
    </div>
  );
}

export default ConvoSimulatorView;
