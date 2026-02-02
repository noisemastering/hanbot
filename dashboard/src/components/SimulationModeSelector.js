// components/SimulationModeSelector.js
// Allows super_admin to simulate viewing the dashboard as a different role/profile
import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import API from '../api';

const SimulationModeSelector = () => {
  const { user, simulationMode, startSimulation, stopSimulation } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [roles, setRoles] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef(null);

  // Only show for super_admin
  if (!user || user.role !== 'super_admin') {
    return null;
  }

  // Load roles and profiles when dropdown opens
  useEffect(() => {
    if (isOpen && roles.length === 0) {
      loadRolesAndProfiles();
    }
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadRolesAndProfiles = async () => {
    setLoading(true);
    try {
      const [rolesRes, profilesRes] = await Promise.all([
        API.get('/roles'),
        API.get('/profiles')
      ]);

      if (rolesRes.data.success) {
        // Filter out super_admin from simulation options
        setRoles(rolesRes.data.data.filter(r => r.name !== 'super_admin'));
      }
      if (profilesRes.data.success) {
        setProfiles(profilesRes.data.data);
      }
    } catch (error) {
      console.error('Error loading roles/profiles:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRole = (role, profile = null) => {
    let permissions = role.permissions || [];
    let label = role.label || role.name;

    // If profile is selected, merge permissions
    if (profile) {
      const profilePerms = profile.permissions || [];
      permissions = [...new Set([...permissions, ...profilePerms])];
      label = `${role.label} / ${profile.label}`;
    }

    startSimulation({
      role: role.name,
      profile: profile?.name || null,
      permissions,
      label
    });

    setIsOpen(false);
  };

  const handleStopSimulation = () => {
    stopSimulation();
    setIsOpen(false);
  };

  // Get profiles for a specific role
  const getProfilesForRole = (roleName) => {
    return profiles.filter(p => p.role === roleName && p.active);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors ${
          simulationMode
            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50'
            : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
        }`}
        title="Simular nivel de acceso"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        <span className="hidden md:block text-sm">
          {simulationMode ? `Vista: ${simulationMode.label}` : 'Ver como...'}
        </span>
        {simulationMode && (
          <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></span>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="p-3 border-b border-gray-700">
            <h3 className="text-sm font-semibold text-white">Simular Nivel de Acceso</h3>
            <p className="text-xs text-gray-400 mt-1">
              Ve el dashboard como lo vería otro usuario
            </p>
          </div>

          {loading ? (
            <div className="p-4 text-center text-gray-400">
              <svg className="animate-spin h-5 w-5 mx-auto mb-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              Cargando roles...
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {/* Exit Simulation Button (if active) */}
              {simulationMode && (
                <button
                  onClick={handleStopSimulation}
                  className="w-full px-4 py-3 text-left text-sm text-red-400 hover:bg-red-500/10 border-b border-gray-700 flex items-center space-x-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span>Salir de simulación</span>
                </button>
              )}

              {/* Roles List */}
              {roles.map(role => {
                const roleProfiles = getProfilesForRole(role.name);
                const isCurrentSimulation = simulationMode?.role === role.name && !simulationMode?.profile;

                return (
                  <div key={role._id} className="border-b border-gray-700/50 last:border-0">
                    {/* Role Header */}
                    <button
                      onClick={() => handleSelectRole(role)}
                      className={`w-full px-4 py-3 text-left hover:bg-gray-700/50 transition-colors ${
                        isCurrentSimulation ? 'bg-primary-500/10' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-sm font-medium text-white">{role.label}</span>
                          {role.permissions?.includes('*') && (
                            <span className="ml-2 text-xs text-amber-400">(Todos los permisos)</span>
                          )}
                        </div>
                        {isCurrentSimulation && (
                          <span className="text-xs text-primary-400">Activo</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        {role.permissions?.includes('*')
                          ? 'Acceso completo'
                          : `${role.permissions?.length || 0} permisos`}
                      </p>
                    </button>

                    {/* Profiles for this Role */}
                    {roleProfiles.length > 0 && (
                      <div className="bg-gray-900/50 border-t border-gray-700/50">
                        {roleProfiles.map(profile => {
                          const isProfileSimulation = simulationMode?.role === role.name && simulationMode?.profile === profile.name;

                          return (
                            <button
                              key={profile._id}
                              onClick={() => handleSelectRole(role, profile)}
                              className={`w-full pl-8 pr-4 py-2 text-left hover:bg-gray-700/30 transition-colors flex items-center justify-between ${
                                isProfileSimulation ? 'bg-primary-500/10' : ''
                              }`}
                            >
                              <div>
                                <span className="text-sm text-gray-300">↳ {profile.label}</span>
                                <span className="text-xs text-gray-500 ml-2">
                                  (+{profile.permissions?.length || 0} permisos)
                                </span>
                              </div>
                              {isProfileSimulation && (
                                <span className="text-xs text-primary-400">Activo</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {roles.length === 0 && (
                <div className="p-4 text-center text-gray-400 text-sm">
                  No hay roles disponibles
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SimulationModeSelector;
