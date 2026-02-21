// components/UserModal.js
import React, { useState, useEffect } from 'react';
import { useTranslation } from '../i18n';
import { useAuth } from '../contexts/AuthContext';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function UserModal({ user, onClose, onSave }) {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [roles, setRoles] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loadingRoles, setLoadingRoles] = useState(true);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    role: 'user',
    profile: '',
    active: true
  });

  // Fetch roles and profiles on component mount
  useEffect(() => {
    fetchRoles();
    fetchProfiles();
  }, []);

  // Update form when user prop changes
  useEffect(() => {
    if (user) {
      setFormData({
        username: user.username || '',
        email: user.email || '',
        password: '', // Don't pre-fill password for security
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        role: (typeof user.role === 'string' ? user.role : user.role?.name) || 'user',
        profile: (typeof user.profile === 'string' ? user.profile : user.profile?.name) || '',
        active: user.active !== undefined ? user.active : true
      });
    }
  }, [user]);

  // Update profile options when role changes
  useEffect(() => {
    if (!loadingRoles && formData.role) {
      const selectedRole = roles.find(r => r.name === formData.role);

      // If the role changed and it has profiles, set default profile
      if (selectedRole?.allowsProfiles && !user) {
        const roleProfiles = getProfilesForRole(formData.role);
        if (roleProfiles.length > 0 && !formData.profile) {
          setFormData(prev => ({ ...prev, profile: roleProfiles[0].name }));
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.role, loadingRoles, roles, profiles, user]);

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
        setRoles(data.roles.filter(r => r.active));
      }
    } catch (error) {
      console.error('Error fetching roles:', error);
    } finally {
      setLoadingRoles(false);
    }
  };

  const fetchProfiles = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/profiles`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.success) {
        setProfiles(data.profiles.filter(p => p.active));
      }
    } catch (error) {
      console.error('Error fetching profiles:', error);
    }
  };

  const getProfilesForRole = (roleName) => {
    const selectedRole = roles.find(r => r.name === roleName);
    if (!selectedRole) return [];

    return profiles.filter(p => p.role?._id === selectedRole._id);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    // Validate required fields
    if (!formData.username || !formData.email || !formData.firstName || !formData.lastName) {
      alert(t('userModal.alertRequired'));
      return;
    }

    // Validate password for new users
    if (!user && !formData.password) {
      alert(t('userModal.alertPasswordRequired'));
      return;
    }

    // Validate profile based on role configuration
    const selectedRole = roles.find(r => r.name === formData.role);
    if (selectedRole?.allowsProfiles) {
      const roleProfiles = getProfilesForRole(formData.role);
      if (roleProfiles.length > 0 && !formData.profile) {
        alert(t('userModal.alertProfileRequired'));
        return;
      }
    }

    // Prepare data to send
    const dataToSend = { ...formData };

    // Don't send password if it's empty (for updates)
    if (user && !formData.password) {
      delete dataToSend.password;
    }

    // Clear profile if role doesn't allow profiles
    if (!selectedRole?.allowsProfiles) {
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
            {user ? t('userModal.editTitle') : t('userModal.newTitle')}
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
                {t('userModal.firstNameRequired')}
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
                {t('userModal.lastNameRequired')}
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
              {t('userModal.usernameRequired')}
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
              <p className="mt-1 text-xs text-gray-500">{t('userModal.usernameCannotChange')}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('userModal.emailRequired')}
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
              {t('userModal.passwordLabel')} {!user && '*'}
            </label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder={user ? t('userModal.passwordPlaceholderEdit') : "Contraseña"}
              required={!user}
            />
            {user && (
              <p className="mt-1 text-xs text-gray-500">{t('userModal.passwordEditHint')}</p>
            )}
          </div>

          {/* Role & Profile */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('userModal.roleRequired')}
              </label>
              {loadingRoles ? (
                <div className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-gray-400">
                  {t('userModal.loadingRoles')}
                </div>
              ) : (
                <select
                  value={formData.role}
                  onChange={(e) => {
                    const newRole = e.target.value;
                    const selectedRole = roles.find(r => r.name === newRole);
                    let newProfile = null;

                    // Set default profile based on role if it allows profiles
                    if (selectedRole?.allowsProfiles) {
                      const roleProfiles = getProfilesForRole(newRole);
                      if (roleProfiles.length > 0) {
                        newProfile = roleProfiles[0].name;
                      }
                    }

                    setFormData({ ...formData, role: newRole, profile: newProfile });
                  }}
                  className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  required
                >
                  {roles
                    .filter(role => {
                      // Super admins can see all roles
                      if (currentUser?.role === 'super_admin') return true;
                      // Admins can only see non-admin roles
                      return role.name !== 'super_admin' && role.name !== 'admin';
                    })
                    .map(role => (
                      <option key={role._id} value={role.name}>
                        {role.label}
                      </option>
                    ))}
                </select>
              )}
            </div>

            {!loadingRoles && roles.length > 0 && (() => {
              const selectedRole = roles.find(r => r.name === formData.role);
              if (!selectedRole?.allowsProfiles) return null;

              const roleProfiles = getProfilesForRole(formData.role);
              if (roleProfiles.length === 0) return null;

              return (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('userModal.profileRequired')}
                  </label>
                  <select
                    value={formData.profile || ''}
                    onChange={(e) => setFormData({ ...formData, profile: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    required
                  >
                    {roleProfiles.map(profile => (
                      <option key={profile._id} value={profile.name}>
                        {profile.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })()}
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
              {t('userModal.activeCheckbox')}
            </label>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              {t('userModal.cancel')}
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
            >
              {user ? t('userModal.updateUser') : t('userModal.createUser')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default UserModal;
