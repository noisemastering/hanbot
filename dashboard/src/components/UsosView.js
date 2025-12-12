import React from 'react';

function UsosView({
  usos,
  loading,
  onAdd,
  onEdit,
  onDelete
}) {
  return (
    <div>
      {/* Header with Add Button */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Usos</h1>
          <p className="text-gray-400 mt-2">Gestiona los diferentes usos y aplicaciones de productos</p>
        </div>
        <button
          onClick={onAdd}
          className="px-6 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center space-x-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Nuevo Uso</span>
        </button>
      </div>

      {/* Usos Table */}
      <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-xl font-bold text-white">Lista de Usos</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-gray-400 mt-4">Cargando usos...</p>
          </div>
        ) : usos.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-700/50 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No hay usos registrados</h3>
            <p className="text-gray-400 mb-6">Comienza agregando el primer uso</p>
            <button
              onClick={onAdd}
              className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors inline-flex items-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Agregar Uso</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-900/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Nombre
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Descripción
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {usos.map((uso) => (
                  <tr key={uso._id} className="hover:bg-gray-700/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="text-sm font-medium text-white">{uso.name}</div>
                        {!uso.available && (
                          <span className="px-2 py-0.5 bg-red-500/20 text-red-300 rounded text-xs font-medium">
                            Inactivo
                          </span>
                        )}
                      </div>
                      {uso.products && uso.products.length > 0 && (
                        <div className="text-xs text-gray-500 mt-1">
                          {uso.productCount || uso.products.length} producto{(uso.productCount || uso.products.length) !== 1 ? 's' : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-300">
                        {uso.description || '-'}
                      </div>
                      {uso.products && uso.products.length > 0 && (() => {
                        const populatedProducts = uso.products.filter(p => typeof p === 'object' && p.name);
                        const unpopulatedCount = uso.products.length - populatedProducts.length;

                        if (populatedProducts.length === 0 && unpopulatedCount > 0) {
                          return (
                            <div className="mt-2 text-xs text-yellow-500">
                              ⚠️ {unpopulatedCount} producto{unpopulatedCount !== 1 ? 's' : ''} no encontrado{unpopulatedCount !== 1 ? 's' : ''}
                            </div>
                          );
                        }

                        return (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {populatedProducts.slice(0, 3).map((product, idx) => (
                              <span key={idx} className="px-2 py-0.5 bg-primary-500/20 text-primary-300 rounded text-xs">
                                {product.name}
                              </span>
                            ))}
                            {populatedProducts.length > 3 && (
                              <span className="px-2 py-0.5 bg-gray-700/50 text-gray-400 rounded text-xs">
                                +{populatedProducts.length - 3} más
                              </span>
                            )}
                            {unpopulatedCount > 0 && (
                              <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-xs">
                                ⚠️ {unpopulatedCount} no encontrado{unpopulatedCount !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => onEdit(uso)}
                          className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => onDelete(uso)}
                          className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                          title="Eliminar"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default UsosView;
