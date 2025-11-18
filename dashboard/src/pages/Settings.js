import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";

function Settings() {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage({ type: "", text: "" });

    // Validation
    if (!formData.currentPassword || !formData.newPassword || !formData.confirmPassword) {
      setMessage({ type: "error", text: "Todos los campos son requeridos" });
      return;
    }

    if (formData.newPassword.length < 6) {
      setMessage({ type: "error", text: "La nueva contraseña debe tener al menos 6 caracteres" });
      return;
    }

    if (formData.newPassword !== formData.confirmPassword) {
      setMessage({ type: "error", text: "Las contraseñas no coinciden" });
      return;
    }

    setLoading(true);

    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${process.env.REACT_APP_API_URL}/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          currentPassword: formData.currentPassword,
          newPassword: formData.newPassword
        })
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: "success", text: "Contraseña cambiada exitosamente" });
        setFormData({ currentPassword: "", newPassword: "", confirmPassword: "" });
      } else {
        setMessage({ type: "error", text: data.error || "Error al cambiar la contraseña" });
      }
    } catch (error) {
      console.error("Error changing password:", error);
      setMessage({ type: "error", text: "Error al cambiar la contraseña" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold mb-6">⚙️ Configuración</h2>

      {/* User Info Section */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-200">Información de Usuario</h3>
        <div className="space-y-3">
          <div className="flex justify-between py-2 border-b border-gray-700">
            <span className="text-gray-400">Usuario:</span>
            <span className="text-white font-medium">{user?.username}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-700">
            <span className="text-gray-400">Nombre completo:</span>
            <span className="text-white">{user?.fullName || "—"}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-700">
            <span className="text-gray-400">Email:</span>
            <span className="text-white">{user?.email || "—"}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-700">
            <span className="text-gray-400">Rol:</span>
            <span className="text-white">{user?.roleLabel || user?.role}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-gray-400">Perfil:</span>
            <span className="text-white">{user?.profileLabel || user?.profile || "—"}</span>
          </div>
        </div>
      </div>

      {/* Change Password Section */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-200">Cambiar Contraseña</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Current Password */}
          <div>
            <label className="block text-gray-300 text-sm font-medium mb-2">
              Contraseña Actual
            </label>
            <input
              type="password"
              value={formData.currentPassword}
              onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
              className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Ingresa tu contraseña actual"
              disabled={loading}
            />
          </div>

          {/* New Password */}
          <div>
            <label className="block text-gray-300 text-sm font-medium mb-2">
              Nueva Contraseña
            </label>
            <input
              type="password"
              value={formData.newPassword}
              onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
              className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Mínimo 6 caracteres"
              disabled={loading}
            />
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-gray-300 text-sm font-medium mb-2">
              Confirmar Nueva Contraseña
            </label>
            <input
              type="password"
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Confirma tu nueva contraseña"
              disabled={loading}
            />
          </div>

          {/* Message */}
          {message.text && (
            <div
              className={`p-3 rounded-lg ${
                message.type === "success"
                  ? "bg-green-500/20 border border-green-500 text-green-400"
                  : "bg-red-500/20 border border-red-500 text-red-400"
              }`}
            >
              {message.text}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Cambiando contraseña..." : "Cambiar Contraseña"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Settings;
