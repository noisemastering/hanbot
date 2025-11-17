// components/ProfilesView.js
import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import ProfileModal from './ProfileModal';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function ProfilesView() {
  const [profiles, setProfiles] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState(null);

  useEffect(() => {
    fetchProfiles();
    fetchRoles();
  }, []);

  const fetchProfiles = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/profiles`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.success) {
        setProfiles(data.profiles);
      }
    } catch (error) {
      console.error('Error fetching profiles:', error);
      toast.error('Error al cargar perfiles');
    } finally {
      setLoading(false);
    }
  };

  const fetchRoles = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/roles`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.success) {
        setRoles(data.roles);
      }
    } catch (error) {
      console.error('Error fetching roles:', error);
    }
  };

  const handleSaveProfile = async (profileData) => {
    try {
      const token = localStorage.getItem('token');
      const url = editingProfile
        ? `${API_URL}/profiles/${editingProfile._id}`
        : `${API_URL}/profiles`;

      const res = await fetch(url, {
        method: editingProfile ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(profileData)
      });

      const data = await res.json();
      if (data.success) {
        await fetchProfiles();
        setShowProfileModal(false);
        setEditingProfile(null);
        toast.success(editingProfile ? 'Perfil actualizado correctamente' : 'Perfil creado correctamente');
      } else {
        toast.error(data.error || 'Error al guardar perfil');
      }
    } catch (error) {
      console.error('Error saving profile:', error);
      toast.error('Error al guardar perfil');
    }
  };

  const handleDeleteProfile = async (profileId) => {
    if (!window.confirm('¿Estás seguro de eliminar este perfil?')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/profiles/${profileId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await res.json();
      if (data.success) {
        await fetchProfiles();
        toast.success('Perfil eliminado correctamente');
      } else {
        toast.error(data.error || 'Error al eliminar perfil');
      }
    } catch (error) {
      console.error('Error deleting profile:', error);
      toast.error('Error al eliminar perfil');
    }
  };

  // Group profiles by role
  const profilesByRole = profiles.reduce((acc, profile) => {
    const roleId = profile.role?._id || 'no_role';
    if (!acc[roleId]) {
      acc[roleId] = {
        role: profile.role,
        profiles: []
      };
    }
    acc[roleId].profiles.push(profile);
    return acc;
  }, {});

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Gestión de Perfiles</h2>
          <p className="text-sm text-gray-400 mt-1">Administra los perfiles dentro de cada rol</p>
        </div>
        <button
          onClick={() => {
            setEditingProfile(null);
            setShowProfileModal(true);
          }}
          className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors flex items-center space-x-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Nuevo Perfil</span>
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500 mx-auto"></div>
          <p className="mt-4 text-gray-400">Cargando perfiles...</p>
        </div>
      ) : profiles.length === 0 ? (
        <div className="text-center py-12 bg-gray-800/30 rounded-lg border border-gray-700/50">
          <div className="text-6xl mb-4">👤</div>
          <h3 className="text-lg font-semibold text-white mb-2">No hay perfiles</h3>
          <p className="text-gray-400">Crea el primer perfil del sistema</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(profilesByRole).map(([roleId, { role, profiles: roleProfiles }]) => (
            <div key={roleId} className="bg-gray-800/20 rounded-lg border border-gray-700/30 overflow-hidden">
              {/* Role Header */}
              <div className="bg-gray-800/50 px-6 py-3 border-b border-gray-700/50">
                <div className="flex items-center space-x-3">
                  <h3 className="text-lg font-semibold text-white">
                    {role?.label || 'Sin Rol'}
                  </h3>
                  <span className="text-xs text-gray-500 font-mono bg-gray-700/50 px-2 py-1 rounded">
                    {role?.name || 'N/A'}
                  </span>
                  <span className="text-sm text-gray-400">
                    ({roleProfiles.length} {roleProfiles.length === 1 ? 'perfil' : 'perfiles'})
                  </span>
                </div>
              </div>

              {/* Profiles Grid */}
              <div className="p-4 grid gap-4">
                {roleProfiles.map((profile) => (
                  <div
                    key={profile._id}
                    className="bg-gray-800/30 rounded-lg border border-gray-700/50 p-4 hover:border-gray-600/50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          <h4 className="text-base font-semibold text-white">{profile.label}</h4>
                          <span className="text-xs text-gray-500 font-mono bg-gray-700/50 px-2 py-1 rounded">
                            {profile.name}
                          </span>
                          {profile.isSystem && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-500/20 text-purple-300 border border-purple-500/30">
                              Sistema
                            </span>
                          )}
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            profile.active
                              ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                              : 'bg-red-500/20 text-red-300 border border-red-500/30'
                          }`}>
                            {profile.active ? 'Activo' : 'Inactivo'}
                          </span>
                        </div>

                        {profile.description && (
                          <p className="text-sm text-gray-400 mb-3">{profile.description}</p>
                        )}

                        <div className="space-y-2">
                          <div className="flex items-start space-x-2">
                            <span className="text-xs text-gray-500 font-medium min-w-[100px]">Permisos:</span>
                            <div className="flex flex-wrap gap-1">
                              {profile.permissions.includes('*') ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                                  Todos (*)
                                </span>
                              ) : profile.permissions.length > 0 ? (
                                profile.permissions.map((perm) => (
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

                          {profile.createdBy?.username && (
                            <div className="flex items-center space-x-2">
                              <span className="text-xs text-gray-500 font-medium min-w-[100px]">Creado por:</span>
                              <span className="text-xs text-gray-400">
                                {profile.createdBy.username}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 ml-4">
                        <button
                          onClick={() => {
                            setEditingProfile(profile);
                            setShowProfileModal(true);
                          }}
                          className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        {!profile.isSystem && (
                          <button
                            onClick={() => handleDeleteProfile(profile._id)}
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
            </div>
          ))}
        </div>
      )}

      {showProfileModal && (
        <ProfileModal
          profile={editingProfile}
          roles={roles}
          onClose={() => {
            setShowProfileModal(false);
            setEditingProfile(null);
          }}
          onSave={handleSaveProfile}
        />
      )}
    </div>
  );
}

export default ProfilesView;
