// components/DuplicateAsColorModal.js
// Tiny modal: given a sellable leaf, clone it as a sibling with a
// different color. Copies price, links, attributes — everything except
// the color name (and SKU, which has to be unique).

import React, { useState } from 'react';

export default function DuplicateAsColorModal({ product, onConfirm, onCancel }) {
  const [newColor, setNewColor] = useState('');
  const [mlLink, setMlLink] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // What we'll suggest the resulting name will be (mirrors the backend logic)
  const KNOWN_COLORS = ['negro','blanco','beige','gris','verde','azul','rojo','amarillo','naranja','rosa','morado','marrón','marron','café','cafe','plata','dorado','transparente','crema','arena','khaki','caqui','vino','turquesa','olivo','terracota'];
  const previewName = (() => {
    if (!newColor) return product?.name || '';
    const name = product?.name || `Color ${newColor}`;
    const match = KNOWN_COLORS.find(c => new RegExp(`\\b${c}\\b`, 'i').test(name));
    if (match) return name.replace(new RegExp(`\\b${match}\\b`, 'gi'), newColor);
    if (/^color\s+/i.test(name)) return `Color ${newColor}`;
    return `${name} - ${newColor}`;
  })();

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!newColor.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm({ newColor: newColor.trim(), mlLink: mlLink.trim() || undefined });
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Error');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[1100] flex items-center justify-center p-4"
      onClick={onCancel}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}
        className="bg-gray-800 border border-gray-700 rounded-xl max-w-md w-full shadow-xl">
        <div className="px-5 py-4 border-b border-gray-700 flex justify-between items-start">
          <div>
            <h3 className="text-white font-semibold">Duplicar como nuevo color</h3>
            <p className="text-xs text-gray-400 mt-1">
              Copia precio, links y atributos. Solo cambia el color.
            </p>
          </div>
          <button type="button" onClick={onCancel} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Origen</label>
            <p className="text-sm text-white px-3 py-2 bg-gray-900/50 rounded-lg border border-gray-700">
              {product?.name || '—'}
            </p>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Nuevo color *</label>
            <input
              type="text"
              autoFocus
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              placeholder="Ej: Verde, Azul, Rojo…"
              className="w-full px-3 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Link de ML (opcional)</label>
            <input
              type="url"
              value={mlLink}
              onChange={(e) => setMlLink(e.target.value)}
              placeholder="https://mercadolibre.com.mx/… — déjalo vacío para copiar el actual"
              className="w-full px-3 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-[11px] text-gray-500 mt-1">Si lo dejas vacío, se copia el link original. Puedes editarlo después.</p>
          </div>

          <div className="border-t border-gray-700/50 pt-3">
            <p className="text-xs text-gray-400 mb-1">Vista previa del nombre</p>
            <p className="text-sm text-purple-300 font-medium">{previewName || '—'}</p>
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2">{error}</p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-700 flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            className="px-4 py-2 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">
            Cancelar
          </button>
          <button type="submit" disabled={!newColor.trim() || submitting}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium">
            {submitting ? 'Creando…' : 'Crear duplicado'}
          </button>
        </div>
      </form>
    </div>
  );
}
