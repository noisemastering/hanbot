import React, { useState, useRef } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'https://hanbot-production.up.railway.app';

/**
 * CatalogUpload component for uploading PDF catalogs
 * Works with Campaign, AdSet, or Ad
 *
 * @param {string} entityType - 'campaign', 'adset', or 'ad'
 * @param {string} entityId - MongoDB _id of the entity
 * @param {object} currentCatalog - Current catalog object { url, name, uploadedAt }
 * @param {function} onUploadSuccess - Callback when upload succeeds
 * @param {function} onDeleteSuccess - Callback when delete succeeds
 * @param {string} inheritedFrom - If catalog is inherited, show source (e.g., "Campaign: Malla Agrícola")
 */
export default function CatalogUpload({
  entityType,
  entityId,
  currentCatalog,
  onUploadSuccess,
  onDeleteSuccess,
  inheritedFrom = null
}) {
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileSelect = async (file) => {
    if (!file) return;

    // Validate file type
    if (file.type !== 'application/pdf') {
      setError('Solo se permiten archivos PDF');
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      setError('El archivo no puede ser mayor a 10MB');
      return;
    }

    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('catalog', file);

      const uploadUrl = `${API_URL}/uploads/catalog/${entityType}/${entityId}`;
      console.log('Uploading to:', uploadUrl);

      const response = await fetch(uploadUrl, {
        method: 'POST',
        body: formData
      });

      console.log('Response status:', response.status, response.statusText);

      // Get response text first to handle both JSON and HTML errors
      const responseText = await response.text();
      console.log('Response preview:', responseText.substring(0, 200));

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        // Response is not JSON (likely HTML error page)
        console.error('Failed to parse response as JSON:', responseText.substring(0, 500));
        throw new Error(`Server returned non-JSON response (status ${response.status}). Check console for details.`);
      }

      if (!response.ok) {
        throw new Error(data.error || 'Error al subir el archivo');
      }

      if (onUploadSuccess) {
        onUploadSuccess(data.data.catalog);
      }
    } catch (err) {
      console.error('Upload error:', err);
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('¿Eliminar este catálogo?')) return;

    setDeleting(true);
    setError(null);

    try {
      const deleteUrl = `${API_URL}/uploads/catalog/${entityType}/${entityId}`;
      console.log('Deleting from:', deleteUrl);

      const response = await fetch(deleteUrl, {
        method: 'DELETE'
      });

      console.log('Response status:', response.status, response.statusText);

      const responseText = await response.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Failed to parse response as JSON:', responseText.substring(0, 500));
        throw new Error(`Server returned non-JSON response (status ${response.status}).`);
      }

      if (!response.ok) {
        throw new Error(data.error || 'Error al eliminar el archivo');
      }

      if (onDeleteSuccess) {
        onDeleteSuccess();
      }
    } catch (err) {
      console.error('Delete error:', err);
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFileSelect(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleInputChange = (e) => {
    const file = e.target.files[0];
    handleFileSelect(file);
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-300">
        Catálogo PDF
      </label>

      {/* Current catalog display */}
      {currentCatalog?.url ? (
        <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-red-500/20 rounded-lg">
              <svg className="w-6 h-6 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-white font-medium truncate max-w-[200px]">
                {currentCatalog.name || 'Catálogo.pdf'}
              </p>
              {inheritedFrom && (
                <p className="text-xs text-amber-400">
                  Heredado de: {inheritedFrom}
                </p>
              )}
              {currentCatalog.uploadedAt && !inheritedFrom && (
                <p className="text-xs text-gray-500">
                  Subido: {new Date(currentCatalog.uploadedAt).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <a
              href={currentCatalog.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              title="Ver catálogo"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
            {!inheritedFrom && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                title="Eliminar catálogo"
              >
                {deleting ? (
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                )}
              </button>
            )}
          </div>
        </div>
      ) : inheritedFrom ? (
        <p className="text-sm text-gray-500 italic">
          Sin catálogo propio. Usando el heredado de: {inheritedFrom}
        </p>
      ) : null}

      {/* Upload area */}
      {!inheritedFrom && (
        <div
          onClick={openFileDialog}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`
            relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer
            transition-colors
            ${dragOver
              ? 'border-primary-500 bg-primary-500/10'
              : 'border-gray-700 hover:border-gray-600 hover:bg-gray-800/30'
            }
            ${uploading ? 'pointer-events-none opacity-50' : ''}
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleInputChange}
            className="hidden"
          />

          {uploading ? (
            <div className="flex flex-col items-center">
              <svg className="w-8 h-8 text-primary-500 animate-spin mb-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <p className="text-sm text-gray-400">Subiendo catálogo...</p>
            </div>
          ) : (
            <>
              <svg className="w-8 h-8 text-gray-500 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm text-gray-400">
                {currentCatalog?.url ? 'Reemplazar catálogo' : 'Subir catálogo PDF'}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Arrastra o haz clic para seleccionar (máx. 10MB)
              </p>
            </>
          )}
        </div>
      )}

      {/* Override notice for inherited catalogs */}
      {inheritedFrom && (
        <div
          onClick={openFileDialog}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`
            border border-dashed rounded-lg p-4 text-center cursor-pointer
            transition-colors border-gray-700 hover:border-amber-500/50 hover:bg-amber-500/5
            ${uploading ? 'pointer-events-none opacity-50' : ''}
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleInputChange}
            className="hidden"
          />
          <p className="text-xs text-amber-400">
            Subir catálogo propio para sobrescribir el heredado
          </p>
        </div>
      )}

      {/* Error message */}
      {error && (
        <p className="text-sm text-red-400 flex items-center space-x-1">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
