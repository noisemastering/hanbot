// components/RolesView.js
import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import RoleModal from './RoleModal';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function RolesView() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState(null);

  useEffect(() => {
    fetchRoles();
  }, []);

  const fetchRoles = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/roles`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.success) {
        setRoles(data.data || data.roles || []);
      }
    } catch (error) {
      console.error('Error fetching roles:', error);
      toast.error('Error al cargar roles');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRole = async (roleData) => {
    try {
      const token = localStorage.getItem('token');
      const url = editingRole
        ? `${API_URL}/roles/${editingRole._id}`
        : `${API_URL}/roles`;

      const res = await fetch(url, {
        method: editingRole ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(roleData)
      });

      const data = await res.json();
      if (data.success) {
        await fetchRoles();
        setShowRoleModal(false);
        setEditingRole(null);
        toast.success(editingRole ? 'Rol actualizado correctamente' : 'Rol creado correctamente');
      } else {
        toast.error(data.error || 'Error al guardar rol');
      }
    } catch (error) {
      console.error('Error saving role:', error);
      toast.error('Error al guardar rol');
    }
  };

  const handleDeleteRole = async (roleId) => {
    if (!window.confirm('¿Estás seguro de eliminar este rol?')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/roles/${roleId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await res.json();
      if (data.success) {
        await fetchRoles();
        toast.success('Rol eliminado correctamente');
      } else {
        toast.error(data.error || 'Error al eliminar rol');
      }
    } catch (error) {
      console.error('Error deleting role:', error);
      toast.error('Error al eliminar rol');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Gestión de Roles</h2>
          <p className="text-sm text-gray-400 mt-1">Administra los roles del sistema y sus permisos</p>
        </div>
        <button
          onClick={() => {
            setEditingRole(null);
            setShowRoleModal(true);
          }}
          className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors flex items-center space-x-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Nuevo Rol</span>
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500 mx-auto"></div>
          <p className="mt-4 text-gray-400">Cargando roles...</p>
        </div>
      ) : roles.length === 0 ? (
        <div className="text-center py-12 bg-gray-800/30 rounded-lg border border-gray-700/50">
          <div className="text-6xl mb-4">🔐</div>
          <h3 className="text-lg font-semibold text-white mb-2">No hay roles</h3>
          <p className="text-gray-400">Crea el primer rol del sistema</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {roles.map((role) => (
            <div
              key={role._id}
              className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-6 hover:border-gray-600/50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-2">
                    <h3 className="text-lg font-semibold text-white">{role.label}</h3>
                    <span className="text-xs text-gray-500 font-mono bg-gray-700/50 px-2 py-1 rounded">
                      {role.name}
                    </span>
                    {role.isSystem && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-500/20 text-purple-300 border border-purple-500/30">
                        Sistema
                      </span>
                    )}
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      role.active
                        ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                        : 'bg-red-500/20 text-red-300 border border-red-500/30'
                    }`}>
                      {role.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>

                  {role.description && (
                    <p className="text-sm text-gray-400 mb-3">{role.description}</p>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-start space-x-2">
                      <span className="text-xs text-gray-500 font-medium min-w-[120px]">Permisos:</span>
                      <div className="flex flex-wrap gap-1">
                        {role.permissions.includes('*') ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                            Todos (*)
                          </span>
                        ) : role.permissions.length > 0 ? (
                          role.permissions.map((perm) => (
                            <span
                              key={perm}
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30"
                            >
                              {perm}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-gray-500">Sin permisos</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-gray-500 font-medium min-w-[120px]">Permite perfiles:</span>
                      <span className={`text-xs font-medium ${role.allowsProfiles ? 'text-green-400' : 'text-gray-500'}`}>
                        {role.allowsProfiles ? 'Sí' : 'No'}
                      </span>
                    </div>

                    {role.createdBy?.username && (
                      <div className="flex items-center space-x-2">
                        <span className="text-xs text-gray-500 font-medium min-w-[120px]">Creado por:</span>
                        <span className="text-xs text-gray-400">
                          {role.createdBy.username}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-2 ml-4">
                  <button
                    onClick={() => {
                      setEditingRole(role);
                      setShowRoleModal(true);
                    }}
                    className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors"
                    title="Editar"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  {!role.isSystem && (
                    <button
                      onClick={() => handleDeleteRole(role._id)}
                      className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                      title="Eliminar"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showRoleModal && (
        <RoleModal
          role={editingRole}
          onClose={() => {
            setShowRoleModal(false);
            setEditingRole(null);
          }}
          onSave={handleSaveRole}
        />
      )}
    </div>
  );
}

export default RolesView;
