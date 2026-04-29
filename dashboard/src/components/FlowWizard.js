import React, { useState, useEffect } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const STEPS = [
  { id: 1, label: 'Producto', icon: '📦' },
  { id: 2, label: 'Canal', icon: '🛒' },
  { id: 3, label: 'Personalidad', icon: '🤖' },
  { id: 4, label: 'Confirmar', icon: '✅' }
];

export default function FlowWizard({ editing, onSave, onClose }) {
  const [step, setStep] = useState(1);
  const [families, setFamilies] = useState([]);
  const [subfamilies, setSubfamilies] = useState([]);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    selectedFamily: null,
    selectedSubfamily: null,
    salesChannel: 'retail',
    clientProfile: 'buyer',
    endpointOfSale: 'online_store',
    voice: 'casual',
    installationNote: '',
    allowListing: false,
    offersCatalog: false,
    description: ''
  });

  // Load editing data
  useEffect(() => {
    if (editing) {
      setForm(f => ({
        ...f,
        selectedFamily: editing.products?.[0]?._id || editing.products?.[0] || null,
        salesChannel: editing.salesChannel || 'retail',
        clientProfile: editing.clientProfile || 'buyer',
        endpointOfSale: editing.endpointOfSale || 'online_store',
        voice: editing.voice || 'casual',
        installationNote: editing.installationNote || '',
        allowListing: editing.allowListing || false,
        offersCatalog: editing.offersCatalog || false,
        description: editing.description || ''
      }));
    }
  }, [editing]);

  // Fetch root product families (non-sellable only)
  useEffect(() => {
    fetch(`${API_URL}/product-families/tree`).then(r => r.json()).then(data => {
      if (data.success) {
        const roots = (data.data || []).filter(p => !p.parentId && !p.sellable);
        setFamilies(roots);
      }
    }).catch(() => {});
  }, []);

  // When family changes, load subfamilies
  useEffect(() => {
    if (!form.selectedFamily) { setSubfamilies([]); return; }
    const family = families.find(f => f._id === form.selectedFamily);
    if (family?.children) {
      const subs = family.children.filter(c => !c.sellable);
      setSubfamilies(subs);
    } else {
      // Fetch from API
      fetch(`${API_URL}/product-families/${form.selectedFamily}/children`).then(r => r.json()).then(data => {
        if (data.success) setSubfamilies((data.data || []).filter(c => !c.sellable));
      }).catch(() => setSubfamilies([]));
    }
    setForm(f => ({ ...f, selectedSubfamily: null }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.selectedFamily, families]);

  const selectedFamilyName = families.find(f => f._id === form.selectedFamily)?.name || '';
  const selectedSubName = subfamilies.find(s => s._id === form.selectedSubfamily)?.name || '';
  const productId = form.selectedSubfamily || form.selectedFamily;
  const productName = selectedSubName || selectedFamilyName;

  // Auto-generate display name
  const channelLabel = form.salesChannel === 'retail' ? 'Menudeo' : 'Mayoreo';
  const profileLabel = form.clientProfile === 'buyer' ? 'Comprador' : 'Revendedor';
  const autoName = productName ? `${productName} (${channelLabel})` : '';

  const canNext = () => {
    if (step === 1) return !!form.selectedFamily;
    if (step === 2) return true;
    if (step === 3) return true;
    return true;
  };

  const handleSave = async () => {
    setSaving(true);
    const payload = {
      displayName: autoName,
      products: productId ? [productId] : [],
      salesChannel: form.salesChannel,
      clientProfile: form.clientProfile,
      endpointOfSale: form.endpointOfSale,
      voice: form.voice,
      installationNote: form.installationNote || null,
      allowListing: form.allowListing,
      offersCatalog: form.offersCatalog,
      description: form.description || null
    };
    await onSave(payload);
    setSaving(false);
  };

  const inputClass = "w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500";

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header with steps */}
        <div className="px-6 py-4 border-b border-gray-700/50">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-bold text-white">{editing ? 'Editar Flujo' : 'Nuevo Flujo'}</h2>
            <button onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:bg-gray-700/50 hover:text-white transition-colors" title="Cerrar">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* Step indicator */}
          <div className="flex gap-1">
            {STEPS.map(s => (
              <div key={s.id} className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                step === s.id ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30' :
                step > s.id ? 'bg-green-500/10 text-green-400' : 'bg-gray-700/30 text-gray-500'
              }`}>
                <span>{step > s.id ? '✓' : s.icon}</span>
                <span className="hidden sm:inline">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Product */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-400 mb-1">El flujo maestro se incluye siempre automáticamente.</p>
                <h3 className="text-lg font-semibold text-white mb-4">¿Para qué familia de productos es este flujo?</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {families.map(f => (
                  <button key={f._id} onClick={() => setForm(prev => ({ ...prev, selectedFamily: f._id }))}
                    className={`p-4 rounded-xl border text-left transition-all ${
                      form.selectedFamily === f._id
                        ? 'bg-primary-500/10 border-primary-500/50 text-white'
                        : 'bg-gray-900/30 border-gray-700/50 text-gray-300 hover:border-gray-600'
                    }`}>
                    <p className="text-sm font-medium">{f.name}</p>
                    {f.children && <p className="text-xs text-gray-500 mt-1">{f.children.filter(c => !c.sellable).length} subfamilias</p>}
                  </button>
                ))}
              </div>

              {/* Subfamilies */}
              {subfamilies.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-300 mb-2">¿Subfamilia específica? (opcional)</h4>
                  <p className="text-xs text-gray-500 mb-3">Si no seleccionas una, el flujo cubrirá toda la familia.</p>
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => setForm(prev => ({ ...prev, selectedSubfamily: null }))}
                      className={`p-3 rounded-lg border text-sm transition-all ${
                        !form.selectedSubfamily ? 'bg-primary-500/10 border-primary-500/50 text-white' : 'bg-gray-900/30 border-gray-700/50 text-gray-400 hover:border-gray-600'
                      }`}>
                      Toda la familia
                    </button>
                    {subfamilies.map(s => (
                      <button key={s._id} onClick={() => setForm(prev => ({ ...prev, selectedSubfamily: s._id }))}
                        className={`p-3 rounded-lg border text-sm transition-all ${
                          form.selectedSubfamily === s._id ? 'bg-primary-500/10 border-primary-500/50 text-white' : 'bg-gray-900/30 border-gray-700/50 text-gray-400 hover:border-gray-600'
                        }`}>
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Channel */}
          {step === 2 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-white">¿Cómo se vende este producto?</h3>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-3">Canal de venta</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'retail', label: 'Menudeo', desc: 'Venta individual, el cliente compra para sí mismo', icon: '🛍️' },
                    { value: 'wholesale', label: 'Mayoreo', desc: 'Venta por volumen o rollos completos', icon: '📦' }
                  ].map(c => (
                    <button key={c.value} onClick={() => setForm(f => ({ ...f, salesChannel: c.value, endpointOfSale: c.value === 'retail' ? 'online_store' : 'human' }))}
                      className={`p-4 rounded-xl border text-left transition-all ${
                        form.salesChannel === c.value ? 'bg-primary-500/10 border-primary-500/50' : 'bg-gray-900/30 border-gray-700/50 hover:border-gray-600'
                      }`}>
                      <p className="text-lg mb-1">{c.icon}</p>
                      <p className="text-sm font-medium text-white">{c.label}</p>
                      <p className="text-xs text-gray-400 mt-1">{c.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-3">Perfil del cliente</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'buyer', label: 'Comprador', desc: 'Compra para su propio uso', icon: '🏠' },
                    { value: 'reseller', label: 'Revendedor', desc: 'Compra para revender', icon: '🏪' }
                  ].map(c => (
                    <button key={c.value} onClick={() => setForm(f => ({ ...f, clientProfile: c.value }))}
                      className={`p-4 rounded-xl border text-left transition-all ${
                        form.clientProfile === c.value ? 'bg-primary-500/10 border-primary-500/50' : 'bg-gray-900/30 border-gray-700/50 hover:border-gray-600'
                      }`}>
                      <p className="text-lg mb-1">{c.icon}</p>
                      <p className="text-sm font-medium text-white">{c.label}</p>
                      <p className="text-xs text-gray-400 mt-1">{c.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-3">¿Dónde cierra la venta?</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'online_store', label: 'Tienda en línea', desc: 'El bot envía un link de Mercado Libre', icon: '🛒' },
                    { value: 'human', label: 'Asesor humano', desc: 'Un vendedor toma la conversación', icon: '👤' }
                  ].map(c => (
                    <button key={c.value} onClick={() => setForm(f => ({ ...f, endpointOfSale: c.value }))}
                      className={`p-4 rounded-xl border text-left transition-all ${
                        form.endpointOfSale === c.value ? 'bg-primary-500/10 border-primary-500/50' : 'bg-gray-900/30 border-gray-700/50 hover:border-gray-600'
                      }`}>
                      <p className="text-lg mb-1">{c.icon}</p>
                      <p className="text-sm font-medium text-white">{c.label}</p>
                      <p className="text-xs text-gray-400 mt-1">{c.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Personality */}
          {step === 3 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-white">¿Cómo se comporta el bot?</h3>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-3">Tono de voz</label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: 'casual', label: 'Casual', desc: 'Amigable y cercano', icon: '😊' },
                    { value: 'professional', label: 'Profesional', desc: 'Formal y directo', icon: '💼' },
                    { value: 'technical', label: 'Técnico', desc: 'Detallado y preciso', icon: '🔧' }
                  ].map(c => (
                    <button key={c.value} onClick={() => setForm(f => ({ ...f, voice: c.value }))}
                      className={`p-4 rounded-xl border text-left transition-all ${
                        form.voice === c.value ? 'bg-primary-500/10 border-primary-500/50' : 'bg-gray-900/30 border-gray-700/50 hover:border-gray-600'
                      }`}>
                      <p className="text-lg mb-1">{c.icon}</p>
                      <p className="text-sm font-medium text-white">{c.label}</p>
                      <p className="text-xs text-gray-400 mt-1">{c.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Nota de instalación (opcional)</label>
                <textarea value={form.installationNote} onChange={e => setForm(f => ({ ...f, installationNote: e.target.value }))}
                  rows={2} placeholder="Instrucciones que el bot menciona al cotizar"
                  className={inputClass} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Descripción interna (opcional)</label>
                <input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Notas para el equipo" className={inputClass} />
              </div>

              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.allowListing} onChange={e => setForm(f => ({ ...f, allowListing: e.target.checked }))}
                    className="rounded border-gray-600 text-primary-500 focus:ring-primary-500" />
                  <span className="text-sm text-gray-300">Permitir listar productos</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.offersCatalog} onChange={e => setForm(f => ({ ...f, offersCatalog: e.target.checked }))}
                    className="rounded border-gray-600 text-primary-500 focus:ring-primary-500" />
                  <span className="text-sm text-gray-300">Ofrece catálogo</span>
                </label>
              </div>
            </div>
          )}

          {/* Step 4: Confirm */}
          {step === 4 && (
            <div className="space-y-5">
              <h3 className="text-lg font-semibold text-white">Resumen del flujo</h3>
              <p className="text-sm text-gray-400">Revisa que todo esté correcto antes de guardar.</p>

              <div className="bg-gray-900/50 border border-gray-700/50 rounded-xl p-5 space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Nombre</span>
                  <span className="text-sm text-white font-medium">{autoName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Producto</span>
                  <span className="text-sm text-white">{productName}</span>
                </div>
                {selectedSubName && (
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-400">Subfamilia</span>
                    <span className="text-sm text-white">{selectedSubName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Canal</span>
                  <span className="text-sm text-white">{channelLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Perfil</span>
                  <span className="text-sm text-white">{profileLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Cierre de venta</span>
                  <span className="text-sm text-white">{form.endpointOfSale === 'online_store' ? 'Tienda en línea' : 'Asesor humano'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Voz</span>
                  <span className="text-sm text-white">{form.voice === 'casual' ? 'Casual' : form.voice === 'professional' ? 'Profesional' : 'Técnico'}</span>
                </div>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 text-sm text-blue-300">
                <p className="font-medium mb-1">Incluye automáticamente:</p>
                <p>✓ Flujo maestro (preguntas generales, ubicación, horarios)</p>
                <p>✓ Flujo de producto (precios, medidas, colores)</p>
                <p>✓ Flujo de {channelLabel.toLowerCase()} ({form.endpointOfSale === 'online_store' ? 'links de compra' : 'captura de datos'})</p>
                <p>✓ Flujo de {profileLabel.toLowerCase()} (trato personalizado)</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700/50 flex justify-between">
          <button onClick={() => step > 1 ? setStep(step - 1) : onClose()}
            className="px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors text-sm">
            {step === 1 ? 'Cancelar' : '← Anterior'}
          </button>
          {step < 4 ? (
            <button onClick={() => setStep(step + 1)} disabled={!canNext()}
              className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 transition-colors text-sm">
              Siguiente →
            </button>
          ) : (
            <button onClick={handleSave} disabled={saving}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors text-sm font-medium">
              {saving ? 'Guardando...' : 'Crear flujo'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
