import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function authHeaders() {
  const token = localStorage.getItem('token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export default function CompanyInfoView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/company-info`, { headers: authHeaders() });
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/company-info`, {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify(data)
      });
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        setEditing(false);
        toast.success('Información guardada');
      } else {
        toast.error(json.error || 'Error al guardar');
      }
    } catch (err) {
      toast.error('Error: ' + err.message);
    }
    setSaving(false);
  };

  const updateField = (path, value) => {
    setData(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      const keys = path.split('.');
      let obj = copy;
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
      obj[keys[keys.length - 1]] = value;
      return copy;
    });
  };

  const updateSchedule = (dayIndex, field, value) => {
    setData(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      if (!copy.schedule) copy.schedule = DAYS.map(d => ({ day: d, open: '08:00', close: '18:00', closed: d === 'Domingo' }));
      copy.schedule[dayIndex][field] = value;
      return copy;
    });
  };

  const inputClass = "w-full px-3 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500";
  const labelClass = "block text-xs text-gray-400 mb-1";
  const readClass = "text-sm text-white";

  if (loading) {
    return <div className="p-8 text-center"><div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (!data) return <p className="text-gray-400">No se pudo cargar la información</p>;

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Información General</h1>
          <p className="text-gray-400 mt-2">Datos de la empresa visibles para el equipo y utilizados por el bot</p>
        </div>
        {!editing ? (
          <button onClick={() => setEditing(true)}
            className="px-5 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium">
            Editar
          </button>
        ) : (
          <div className="flex gap-3">
            <button onClick={() => { setEditing(false); fetchData(); }}
              className="px-4 py-2 bg-gray-700/50 text-white rounded-lg text-sm">Cancelar</button>
            <button onClick={handleSave} disabled={saving}
              className="px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium">
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-6">
        {/* Basic info */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h3 className="text-sm font-medium text-gray-400 uppercase mb-4">Datos generales</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Nombre comercial</label>
              {editing ? <input className={inputClass} value={data.name || ''} onChange={e => updateField('name', e.target.value)} />
                : <p className={readClass}>{data.name || '—'}</p>}
            </div>
            <div>
              <label className={labelClass}>Razón social</label>
              {editing ? <input className={inputClass} value={data.legalName || ''} onChange={e => updateField('legalName', e.target.value)} />
                : <p className={readClass}>{data.legalName || '—'}</p>}
            </div>
            <div>
              <label className={labelClass}>Eslogan</label>
              {editing ? <input className={inputClass} value={data.tagline || ''} onChange={e => updateField('tagline', e.target.value)} />
                : <p className={readClass}>{data.tagline || '—'}</p>}
            </div>
            <div>
              <label className={labelClass}>RFC</label>
              {editing ? <input className={inputClass} value={data.rfc || ''} onChange={e => updateField('rfc', e.target.value)} />
                : <p className={readClass}>{data.rfc || '—'}</p>}
            </div>
            <div>
              <label className={labelClass}>Industria</label>
              {editing ? <input className={inputClass} value={data.industry || ''} onChange={e => updateField('industry', e.target.value)} />
                : <p className={readClass}>{data.industry || '—'}</p>}
            </div>
            <div>
              <label className={labelClass}>Sitio web</label>
              {editing ? <input className={inputClass} value={data.website || ''} onChange={e => updateField('website', e.target.value)} placeholder="https://" />
                : <p className={readClass}>{data.website ? <a href={data.website} target="_blank" rel="noreferrer" className="text-primary-400 hover:underline">{data.website}</a> : '—'}</p>}
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Descripción</label>
              {editing ? <textarea className={inputClass} rows={2} value={data.description || ''} onChange={e => updateField('description', e.target.value)} />
                : <p className={readClass}>{data.description || '—'}</p>}
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h3 className="text-sm font-medium text-gray-400 uppercase mb-4">Contacto</h3>
          <div className="space-y-3">
            <label className={labelClass}>Teléfonos</label>
            {(data.phones || []).map((p, i) => (
              <div key={i} className="flex gap-2">
                {editing ? (
                  <>
                    <input className={inputClass + ' w-32'} value={p.label || ''} placeholder="Etiqueta"
                      onChange={e => { const phones = [...(data.phones || [])]; phones[i] = { ...phones[i], label: e.target.value }; updateField('phones', phones); }} />
                    <input className={inputClass + ' flex-1'} value={p.number || ''} placeholder="Número"
                      onChange={e => { const phones = [...(data.phones || [])]; phones[i] = { ...phones[i], number: e.target.value }; updateField('phones', phones); }} />
                    <button onClick={() => updateField('phones', data.phones.filter((_, j) => j !== i))} className="text-red-400 text-xs px-2">Quitar</button>
                  </>
                ) : (
                  <p className={readClass}><span className="text-gray-500">{p.label}:</span> {p.number || '—'}</p>
                )}
              </div>
            ))}
            {editing && <button onClick={() => updateField('phones', [...(data.phones || []), { label: '', number: '' }])} className="text-xs text-primary-400 hover:underline">+ Agregar teléfono</button>}
          </div>
          <div className="mt-4 space-y-3">
            <label className={labelClass}>Correos electrónicos</label>
            {(data.emails || []).map((e, i) => (
              <div key={i} className="flex gap-2">
                {editing ? (
                  <>
                    <input className={inputClass + ' w-32'} value={e.label || ''} placeholder="Etiqueta"
                      onChange={ev => { const emails = [...(data.emails || [])]; emails[i] = { ...emails[i], label: ev.target.value }; updateField('emails', emails); }} />
                    <input className={inputClass + ' flex-1'} value={e.email || ''} placeholder="correo@ejemplo.com"
                      onChange={ev => { const emails = [...(data.emails || [])]; emails[i] = { ...emails[i], email: ev.target.value }; updateField('emails', emails); }} />
                    <button onClick={() => updateField('emails', data.emails.filter((_, j) => j !== i))} className="text-red-400 text-xs px-2">Quitar</button>
                  </>
                ) : (
                  <p className={readClass}><span className="text-gray-500">{e.label}:</span> {e.email || '—'}</p>
                )}
              </div>
            ))}
            {editing && <button onClick={() => updateField('emails', [...(data.emails || []), { label: '', email: '' }])} className="text-xs text-primary-400 hover:underline">+ Agregar correo</button>}
          </div>
        </div>

        {/* Location */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h3 className="text-sm font-medium text-gray-400 uppercase mb-4">Ubicación</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className={labelClass}>Dirección</label>
              {editing ? <input className={inputClass} value={data.address || ''} onChange={e => updateField('address', e.target.value)} />
                : <p className={readClass}>{data.address || '—'}</p>}
            </div>
            <div>
              <label className={labelClass}>Ciudad</label>
              {editing ? <input className={inputClass} value={data.city || ''} onChange={e => updateField('city', e.target.value)} />
                : <p className={readClass}>{data.city || '—'}</p>}
            </div>
            <div>
              <label className={labelClass}>Estado</label>
              {editing ? <input className={inputClass} value={data.state || ''} onChange={e => updateField('state', e.target.value)} />
                : <p className={readClass}>{data.state || '—'}</p>}
            </div>
            <div>
              <label className={labelClass}>Código postal</label>
              {editing ? <input className={inputClass} value={data.zipCode || ''} onChange={e => updateField('zipCode', e.target.value)} />
                : <p className={readClass}>{data.zipCode || '—'}</p>}
            </div>
            <div>
              <label className={labelClass}>Google Maps URL</label>
              {editing ? <input className={inputClass} value={data.googleMapsUrl || ''} onChange={e => updateField('googleMapsUrl', e.target.value)} placeholder="https://maps.google.com/..." />
                : <p className={readClass}>{data.googleMapsUrl ? <a href={data.googleMapsUrl} target="_blank" rel="noreferrer" className="text-primary-400 hover:underline">Ver en Google Maps</a> : '—'}</p>}
            </div>
          </div>
        </div>

        {/* Schedule */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h3 className="text-sm font-medium text-gray-400 uppercase mb-4">Horario</h3>
          <div className="space-y-2">
            {DAYS.map((day, i) => {
              const sched = (data.schedule || [])[i] || { day, open: '', close: '', closed: false };
              return (
                <div key={day} className="flex items-center gap-3">
                  <span className={`text-sm w-24 ${sched.closed ? 'text-gray-600' : 'text-white'}`}>{day}</span>
                  {editing ? (
                    <>
                      <label className="flex items-center gap-1 text-xs text-gray-500">
                        <input type="checkbox" checked={sched.closed || false}
                          onChange={e => updateSchedule(i, 'closed', e.target.checked)}
                          className="rounded border-gray-600 text-primary-500" />
                        Cerrado
                      </label>
                      {!sched.closed && (
                        <>
                          <input type="time" className={inputClass + ' w-28'} value={sched.open || ''}
                            onChange={e => updateSchedule(i, 'open', e.target.value)} />
                          <span className="text-gray-500 text-sm">a</span>
                          <input type="time" className={inputClass + ' w-28'} value={sched.close || ''}
                            onChange={e => updateSchedule(i, 'close', e.target.value)} />
                        </>
                      )}
                    </>
                  ) : (
                    <span className={`text-sm ${sched.closed ? 'text-red-400' : 'text-gray-300'}`}>
                      {sched.closed ? 'Cerrado' : `${sched.open || '—'} a ${sched.close || '—'}`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {editing && (
            <div className="mt-3">
              <label className={labelClass}>Notas de horario</label>
              <input className={inputClass} value={data.scheduleNotes || ''} onChange={e => updateField('scheduleNotes', e.target.value)} placeholder="Ej: Cerrado en días festivos" />
            </div>
          )}
          {!editing && data.scheduleNotes && <p className="text-xs text-gray-500 mt-2">{data.scheduleNotes}</p>}
        </div>

        {/* Social media */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h3 className="text-sm font-medium text-gray-400 uppercase mb-4">Redes sociales</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin', 'twitter'].map(network => (
              <div key={network}>
                <label className={labelClass}>{network.charAt(0).toUpperCase() + network.slice(1)}</label>
                {editing ? <input className={inputClass} value={data.social?.[network] || ''} onChange={e => updateField(`social.${network}`, e.target.value)} placeholder="URL" />
                  : <p className={readClass}>{data.social?.[network] ? <a href={data.social[network]} target="_blank" rel="noreferrer" className="text-primary-400 hover:underline truncate block">{data.social[network]}</a> : '—'}</p>}
              </div>
            ))}
          </div>
        </div>

        {/* Marketplaces */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
          <h3 className="text-sm font-medium text-gray-400 uppercase mb-4">Marketplaces</h3>
          <div className="space-y-3">
            {(data.marketplaces || []).map((mp, i) => (
              <div key={i} className="flex gap-2 items-center">
                {editing ? (
                  <>
                    <input className={inputClass + ' w-36'} value={mp.name || ''} placeholder="Nombre"
                      onChange={e => { const mps = [...(data.marketplaces || [])]; mps[i] = { ...mps[i], name: e.target.value }; updateField('marketplaces', mps); }} />
                    <input className={inputClass + ' flex-1'} value={mp.url || ''} placeholder="URL de la tienda"
                      onChange={e => { const mps = [...(data.marketplaces || [])]; mps[i] = { ...mps[i], url: e.target.value }; updateField('marketplaces', mps); }} />
                    <button onClick={() => updateField('marketplaces', data.marketplaces.filter((_, j) => j !== i))} className="text-red-400 text-xs px-2">Quitar</button>
                  </>
                ) : (
                  <p className={readClass}><span className="text-gray-500">{mp.name}:</span> {mp.url ? <a href={mp.url} target="_blank" rel="noreferrer" className="text-primary-400 hover:underline">{mp.url}</a> : '—'}</p>
                )}
              </div>
            ))}
            {editing && <button onClick={() => updateField('marketplaces', [...(data.marketplaces || []), { name: '', url: '', active: true }])} className="text-xs text-primary-400 hover:underline">+ Agregar marketplace</button>}
            {!editing && (!data.marketplaces || data.marketplaces.length === 0) && <p className="text-sm text-gray-500">Sin marketplaces configurados</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
