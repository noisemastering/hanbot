import React, { useState } from 'react';
import UsosView from './UsosView';
import GruposView from './GruposView';

function UsosYGruposView({
  // Usos props
  usos,
  usosLoading,
  onAddUso,
  onEditUso,
  onDeleteUso,
  // Grupos props
  grupos,
  gruposLoading,
  onAddGrupo,
  onEditGrupo,
  onDeleteGrupo
}) {
  const [activeTab, setActiveTab] = useState('usos');

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Usos y Grupos</h1>
        <p className="text-gray-400 mt-2">
          Gestiona usos y agrupaciones de productos para mejorar recomendaciones y organización
        </p>
      </div>

      {/* Tabs Navigation */}
      <div className="mb-6">
        <div className="border-b border-gray-700/50">
          <div className="flex space-x-1">
            <button
              onClick={() => setActiveTab('usos')}
              className={`px-6 py-3 font-medium transition-colors relative ${
                activeTab === 'usos'
                  ? 'text-primary-400'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              Usos
              {activeTab === 'usos' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-500"></div>
              )}
            </button>
            <button
              onClick={() => setActiveTab('grupos')}
              className={`px-6 py-3 font-medium transition-colors relative ${
                activeTab === 'grupos'
                  ? 'text-primary-400'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              Grupos
              {activeTab === 'grupos' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-500"></div>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'usos' && (
          <UsosView
            usos={usos}
            loading={usosLoading}
            onAdd={onAddUso}
            onEdit={onEditUso}
            onDelete={onDeleteUso}
          />
        )}
        {activeTab === 'grupos' && (
          <GruposView
            grupos={grupos}
            loading={gruposLoading}
            onAdd={onAddGrupo}
            onEdit={onEditGrupo}
            onDelete={onDeleteGrupo}
          />
        )}
      </div>
    </div>
  );
}

export default UsosYGruposView;
