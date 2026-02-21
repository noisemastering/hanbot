// components/RoleModal.js
import React, { useState, useEffect } from 'react';
import { useTranslation } from '../i18n';

function RoleModal({ role, onClose, onSave }) {
  const { t } = useTranslation();

  // Available sections for permissions
  const AVAILABLE_SECTIONS = [
    { value: '*', label: t('permissions.allPermissions') },
    { value: 'conversations', label: t('permissions.conversations') },
    { value: 'campaigns', label: t('permissions.campaigns') },
    { value: 'adsets', label: t('permissions.adsets') },
    { value: 'ads', label: t('permissions.ads') },
    { value: 'products', label: t('permissions.products') },
    { value: 'analytics', label: t('permissions.analytics') },
    { value: 'families', label: t('permissions.families') },
    { value: 'master-catalog', label: t('permissions.masterCatalog') },
    { value: 'usos', label: t('permissions.usos') },
    { value: 'inventario', label: t('permissions.inventario') },
    { value: 'users', label: t('permissions.users') }
  ];
  const [formData, setFormData] = useState({
    name: '',
    label: '',
    description: '',
    permissions: [],
    allowsProfiles: false,
    active: true
  });

  useEffect(() => {
    if (role) {
      setFormData({
        name: role.name || '',
        label: role.label || '',
        description: role.description || '',
        permissions: role.permissions || [],
        allowsProfiles: role.allowsProfiles !== undefined ? role.allowsProfiles : false,
        active: role.active !== undefined ? role.active : true
      });
    }
  }, [role]);

  const handleSubmit = (e) => {
    e.preventDefault();

    // Validate required fields
    if (!formData.name || !formData.label) {
      alert(t('roleModal.errorNameLabel'));
      return;
    }

    // Validate name format (lowercase, no spaces)
    if (!/^[a-z_]+$/.test(formData.name)) {
      alert(t('roleModal.errorNameFormat'));
      return;
    }

    onSave(formData);
  };

  const togglePermission = (permission) => {
    setFormData(prev => {
      const newPermissions = prev.permissions.includes(permission)
        ? prev.permissions.filter(p => p !== permission)
        : [...prev.permissions, permission];

      return { ...prev, permissions: newPermissions };
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-gray-700">
        {/* Header */}
        <div className="sticky top-0 bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-white">
            {role ? t('roleModal.edit') : t('roleModal.create')}
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('roleModal.nameIdentifier')}
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value.toLowerCase() })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500 transition-colors"
                placeholder="campaign_admin"
                disabled={role?.isSystem} // Can't change name of system roles
                required
              />
              <p className="text-xs text-gray-500 mt-1">{t('roleModal.nameHelp')}</p>
            </div>

            {/* Label */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('roleModal.labelDisplay')}
              </label>
              <input
                type="text"
                value={formData.label}
                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500 transition-colors"
                placeholder={t('roleModal.labelPlaceholder')}
                required
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('roleModal.description')}
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-primary-500 transition-colors resize-none"
              rows="3"
              placeholder={t('roleModal.description')}
            />
          </div>

          {/* Permissions */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-3">
              {t('roleModal.permissions')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {AVAILABLE_SECTIONS.map(section => (
                <label
                  key={section.value}
                  className={`flex items-center space-x-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                    formData.permissions.includes(section.value)
                      ? 'bg-primary-500/20 border-primary-500 text-white'
                      : 'bg-gray-700/50 border-gray-600 text-gray-300 hover:border-gray-500'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={formData.permissions.includes(section.value)}
                    onChange={() => togglePermission(section.value)}
                    className="w-4 h-4 text-primary-600 bg-gray-700 border-gray-600 rounded focus:ring-primary-500 focus:ring-2"
                  />
                  <span className="text-sm">{section.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Allows Profiles */}
          <div className="flex items-center space-x-3 p-4 bg-gray-700/30 rounded-lg">
            <input
              type="checkbox"
              id="allowsProfiles"
              checked={formData.allowsProfiles}
              onChange={(e) => setFormData({ ...formData, allowsProfiles: e.target.checked })}
              className="w-5 h-5 text-primary-600 bg-gray-700 border-gray-600 rounded focus:ring-primary-500 focus:ring-2"
            />
            <label htmlFor="allowsProfiles" className="text-sm text-gray-300 cursor-pointer">
              <span className="font-medium">{t('roleModal.allowsProfiles')}</span>
              <p className="text-xs text-gray-500 mt-0.5">
                {t('roleModal.allowsProfilesHelp')}
              </p>
            </label>
          </div>

          {/* Active */}
          <div className="flex items-center space-x-3 p-4 bg-gray-700/30 rounded-lg">
            <input
              type="checkbox"
              id="active"
              checked={formData.active}
              onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
              className="w-5 h-5 text-primary-600 bg-gray-700 border-gray-600 rounded focus:ring-primary-500 focus:ring-2"
            />
            <label htmlFor="active" className="text-sm text-gray-300 cursor-pointer">
              <span className="font-medium">{t('roleModal.roleActive')}</span>
              <p className="text-xs text-gray-500 mt-0.5">
                {t('roleModal.roleActiveHelp')}
              </p>
            </label>
          </div>

          {/* System Role Warning */}
          {role?.isSystem && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <div className="flex items-start space-x-2">
                <svg className="w-5 h-5 text-yellow-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-yellow-500">{t('roleModal.systemRole')}</p>
                  <p className="text-xs text-yellow-500/80 mt-1">
                    {t('roleModal.systemRoleHelp')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
            >
              {role ? t('roleModal.saveChanges') : t('roleModal.createRole')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default RoleModal;
