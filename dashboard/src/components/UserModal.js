// components/UserModal.js
import React, { useState, useEffect } from 'react';

function UserModal({ user, onClose, onSave }) {
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    role: 'user',
    profile: 'salesman', // Default for 'user' role
    active: true
  });

  useEffect(() => {
    if (user) {
      setFormData({
        username: user.username || '',
        email: user.email || '',
        password: '', // Don't pre-fill password for security
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        role: user.role || 'user',
        profile: user.profile || 'salesman',
        active: user.active !== undefined ? user.active : true
      });
    }
  }, [user]);

  const handleSubmit = (e) => {
    e.preventDefault();

    // Validate required fields
    if (!formData.username || !formData.email || !formData.firstName || !formData.lastName) {
      alert('Por favor completa todos los campos requeridos');
      return;
    }

    // Validate password for new users
    if (!user && !formData.password) {
      alert('La contraseña es requerida para nuevos usuarios');
      return;
    }

    // Validate profile for 'user' and 'super_user' roles
    if ((formData.role === 'user' || formData.role === 'super_user') && !formData.profile) {
      alert('El perfil es requerido para este rol');
      return;
    }

    // Prepare data to send
    const dataToSend = { ...formData };

    // Don't send password if it's empty (for updates)
    if (user && !formData.password) {
      delete dataToSend.password;
    }

    // Clear profile if not a 'user' or 'super_user' role
    if (formData.role !== 'user' && formData.role !== 'super_user') {
      dataToSend.profile = null;
    }

    onSave(dataToSend);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-gray-700">
        {/* Header */}
        <div className="sticky top-0 bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-white">
            {user ? 'Editar Usuario' : 'Nuevo Usuario'}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Personal Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Nombre *
              </label>
              <input
                type="text"
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Juan"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Apellido *
              </label>
              <input
                type="text"
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Pérez"
                required
              />
            </div>
          </div>

          {/* Account Info */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Usuario *
            </label>
            <input
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="juanperez"
              required
              disabled={!!user} // Can't change username after creation
            />
            {user && (
              <p className="mt-1 text-xs text-gray-500">El nombre de usuario no se puede cambiar</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Email *
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="juan@ejemplo.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Contraseña {!user && '*'}
            </label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder={user ? "Dejar en blanco para no cambiar" : "Contraseña"}
              required={!user}
            />
            {user && (
              <p className="mt-1 text-xs text-gray-500">Dejar en blanco para mantener la contraseña actual</p>
            )}
          </div>

          {/* Role & Profile */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Rol *
              </label>
              <select
                value={formData.role}
                onChange={(e) => {
                  const newRole = e.target.value;
                  let newProfile = null;

                  // Set default profile based on role
                  if (newRole === 'user') {
                    newProfile = 'salesman';
                  } else if (newRole === 'super_user') {
                    newProfile = 'accounting';
                  }

                  setFormData({ ...formData, role: newRole, profile: newProfile });
                }}
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              >
                <option value="super_admin">Super Admin</option>
                <option value="admin">Admin</option>
                <option value="super_user">Super Usuario</option>
                <option value="user">Usuario</option>
              </select>
            </div>

            {formData.role === 'user' && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Perfil *
                </label>
                <select
                  value={formData.profile}
                  onChange={(e) => setFormData({ ...formData, profile: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  required
                >
                  <option value="campaign_manager">Administrador de Campaña</option>
                  <option value="salesman">Ventas</option>
                </select>
              </div>
            )}

            {formData.role === 'super_user' && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Perfil *
                </label>
                <select
                  value={formData.profile}
                  onChange={(e) => setFormData({ ...formData, profile: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  required
                >
                  <option value="accounting">Contabilidad</option>
                  <option value="sales">Ventas</option>
                </select>
              </div>
            )}
          </div>

          {/* Status */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="active"
              checked={formData.active}
              onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
              className="w-4 h-4 text-primary-600 bg-gray-900 border-gray-700 rounded focus:ring-primary-500"
            />
            <label htmlFor="active" className="ml-2 text-sm text-gray-300">
              Usuario activo
            </label>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
            >
              {user ? 'Actualizar' : 'Crear'} Usuario
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default UserModal;
