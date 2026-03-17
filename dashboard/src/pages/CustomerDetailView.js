import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import API from '../api';

const INTENT_COLORS = {
  high: 'bg-green-500/20 text-green-400',
  medium: 'bg-amber-500/20 text-amber-400',
  low: 'bg-red-500/20 text-red-400',
};
const INTENT_LABELS = { high: 'Alto', medium: 'Medio', low: 'Bajo' };

function CustomerDetailView() {
  const { psid } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [messages, setMessages] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [newTag, setNewTag] = useState('');
  const [saving, setSaving] = useState(false);

  const decodedPsid = decodeURIComponent(psid);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get(`/crm/customers/${encodeURIComponent(decodedPsid)}`);
      setCustomer(res.data.customer);
      setMessages(res.data.messages || []);
      setPurchases(res.data.purchases || []);
    } catch (err) {
      console.error('Error fetching customer:', err);
    } finally {
      setLoading(false);
    }
  }, [decodedPsid]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const addNote = async () => {
    if (!newNote.trim()) return;
    setSaving(true);
    try {
      const res = await API.post(`/crm/customers/${encodeURIComponent(decodedPsid)}/notes`, { text: newNote });
      setCustomer(prev => ({ ...prev, notes: res.data.notes }));
      setNewNote('');
    } catch (err) {
      console.error('Error adding note:', err);
    } finally {
      setSaving(false);
    }
  };

  const deleteNote = async (noteId) => {
    try {
      const res = await API.delete(`/crm/customers/${encodeURIComponent(decodedPsid)}/notes/${noteId}`);
      setCustomer(prev => ({ ...prev, notes: res.data.notes }));
    } catch (err) {
      console.error('Error deleting note:', err);
    }
  };

  const addTag = async () => {
    if (!newTag.trim()) return;
    try {
      const res = await API.post(`/crm/customers/${encodeURIComponent(decodedPsid)}/tags`, { tag: newTag });
      setCustomer(prev => ({ ...prev, tags: res.data.tags }));
      setNewTag('');
    } catch (err) {
      console.error('Error adding tag:', err);
    }
  };

  const removeTag = async (tag) => {
    try {
      const res = await API.delete(`/crm/customers/${encodeURIComponent(decodedPsid)}/tags/${encodeURIComponent(tag)}`);
      setCustomer(prev => ({ ...prev, tags: res.data.tags }));
    } catch (err) {
      console.error('Error removing tag:', err);
    }
  };

  const formatCurrency = (amount) => {
    if (!amount && amount !== 0) return '$0';
    return new Intl.NumberFormat('es-MX', {
      style: 'currency', currency: 'MXN',
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('es-MX', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  const formatShortDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('es-MX', {
      day: 'numeric', month: 'short'
    });
  };

  if (loading || !customer) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400"></div>
          <p className="mt-4 text-gray-400">Cargando cliente...</p>
        </div>
      </div>
    );
  }

  const name = customer.productSpecs?.customerName || customer.leadData?.name || decodedPsid.replace(/^(fb:|wa:)/, '');
  const channelLabel = customer.channel === 'whatsapp' ? 'WhatsApp' : customer.channel === 'facebook' ? 'Facebook' : '-';
  const channelColor = customer.channel === 'whatsapp' ? 'text-green-400' : 'text-blue-400';
  const location = [customer.city, customer.stateMx].filter(Boolean).join(', ');
  const notes = customer.notes || [];
  const tags = customer.tags || [];
  const totalRevenue = purchases.reduce((s, p) => s + (p.conversionData?.totalAmount || 0), 0);

  // Build timeline: messages + purchases merged chronologically
  const timeline = [
    ...messages.map(m => ({
      type: 'message',
      date: new Date(m.timestamp),
      sender: m.senderType,
      text: m.text
    })),
    ...purchases.map(p => ({
      type: 'purchase',
      date: new Date(p.convertedAt || p.createdAt),
      product: p.productName || p.conversionData?.itemTitle || 'Producto',
      amount: p.conversionData?.totalAmount || 0,
      method: p.correlationMethod || 'auto'
    }))
  ].sort((a, b) => b.date - a.date);

  const senderIcon = (sender) => {
    if (sender === 'user') return <div className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0"><svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg></div>;
    if (sender === 'human') return <div className="w-7 h-7 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0"><svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>;
    return <div className="w-7 h-7 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0"><svg className="w-3.5 h-3.5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg></div>;
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/crm')} className="text-gray-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">{name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className={`text-sm font-medium ${channelColor}`}>{channelLabel}</span>
            {location && <span className="text-sm text-gray-400">{location}</span>}
            {customer.purchaseIntent && (
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${INTENT_COLORS[customer.purchaseIntent]}`}>
                {INTENT_LABELS[customer.purchaseIntent]}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-sm text-gray-400">Compras</p>
          <p className="text-2xl font-bold text-green-400">{purchases.length}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-sm text-gray-400">Ingresos</p>
          <p className="text-2xl font-bold text-amber-400">{formatCurrency(totalRevenue)}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-sm text-gray-400">Mensajes</p>
          <p className="text-2xl font-bold text-blue-400">{messages.length}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-sm text-gray-400">Primer contacto</p>
          <p className="text-lg font-bold text-purple-400">{formatShortDate(messages[messages.length - 1]?.timestamp)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Profile, Tags, Notes */}
        <div className="space-y-6">
          {/* Profile Card */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 space-y-3">
            <h2 className="text-lg font-semibold text-white">Perfil</h2>
            <div className="space-y-2 text-sm">
              {customer.productSpecs?.customerName && (
                <div className="flex justify-between"><span className="text-gray-400">Nombre</span><span className="text-white">{customer.productSpecs.customerName}</span></div>
              )}
              <div className="flex justify-between"><span className="text-gray-400">Canal</span><span className={channelColor}>{channelLabel}</span></div>
              {customer.city && <div className="flex justify-between"><span className="text-gray-400">Ciudad</span><span className="text-white">{customer.city}</span></div>}
              {customer.stateMx && <div className="flex justify-between"><span className="text-gray-400">Estado</span><span className="text-white">{customer.stateMx}</span></div>}
              {customer.zipCode && <div className="flex justify-between"><span className="text-gray-400">C.P.</span><span className="text-white">{customer.zipCode}</span></div>}
              {customer.currentFlow && (
                <div className="flex justify-between"><span className="text-gray-400">Flow</span><span className="text-white">{customer.currentFlow}</span></div>
              )}
              {customer.productInterest && (
                <div className="flex justify-between"><span className="text-gray-400">Interés</span><span className="text-white">{customer.productInterest}</span></div>
              )}
              {customer.handoffRequested && (
                <div className="flex justify-between"><span className="text-gray-400">Handoff</span><span className="text-amber-400">{customer.handoffReason || 'Solicitado'}</span></div>
              )}
              {customer.futureInterest?.interested && (
                <div className="mt-2 p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <p className="text-xs text-blue-400 font-medium">Interés futuro</p>
                  <p className="text-sm text-white mt-1">{customer.futureInterest.timeframeRaw}</p>
                  {customer.futureInterest.followUpDate && (
                    <p className="text-xs text-gray-400 mt-1">Seguimiento: {formatShortDate(customer.futureInterest.followUpDate)}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Tags */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <h2 className="text-lg font-semibold text-white mb-3">Etiquetas</h2>
            <div className="flex flex-wrap gap-2 mb-3">
              {tags.length === 0 && <p className="text-sm text-gray-500">Sin etiquetas</p>}
              {tags.map(tag => (
                <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-purple-500/20 text-purple-300">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="hover:text-red-400 transition-colors">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTag()}
                placeholder="Nueva etiqueta..."
                className="flex-1 px-3 py-1.5 bg-gray-900/50 border border-gray-700/50 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50"
              />
              <button onClick={addTag} className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg transition-colors">+</button>
            </div>
          </div>

          {/* Notes */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <h2 className="text-lg font-semibold text-white mb-3">Notas</h2>
            <div className="space-y-3 mb-3">
              {notes.length === 0 && <p className="text-sm text-gray-500">Sin notas</p>}
              {notes.slice().reverse().map((note) => (
                <div key={note._id} className="p-3 bg-gray-900/50 rounded-lg">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-white whitespace-pre-wrap">{note.text}</p>
                    <button onClick={() => deleteNote(note._id)} className="text-gray-500 hover:text-red-400 transition-colors shrink-0">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{note.author} - {formatDate(note.createdAt)}</p>
                </div>
              ))}
            </div>
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Escribe una nota..."
              rows={3}
              className="w-full px-3 py-2 bg-gray-900/50 border border-gray-700/50 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 resize-none"
            />
            <button
              onClick={addNote}
              disabled={saving || !newNote.trim()}
              className="mt-2 w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white text-sm rounded-lg transition-colors"
            >
              {saving ? 'Guardando...' : 'Agregar Nota'}
            </button>
          </div>
        </div>

        {/* Right Column: Timeline + Purchases */}
        <div className="lg:col-span-2 space-y-6">
          {/* Purchase History */}
          {purchases.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl">
              <div className="px-5 py-4 border-b border-gray-700/50">
                <h2 className="text-lg font-semibold text-white">Historial de Compras</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-900/50">
                    <tr className="text-left text-xs text-gray-400 uppercase">
                      <th className="px-5 py-3">Producto</th>
                      <th className="px-5 py-3 text-right">Monto</th>
                      <th className="px-5 py-3">Fecha</th>
                      <th className="px-5 py-3">Método</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/50">
                    {purchases.map((p, i) => (
                      <tr key={i} className="hover:bg-gray-700/20">
                        <td className="px-5 py-3 text-sm text-white">{p.productName || p.conversionData?.itemTitle || '-'}</td>
                        <td className="px-5 py-3 text-sm text-green-400 text-right font-medium">{formatCurrency(p.conversionData?.totalAmount || 0)}</td>
                        <td className="px-5 py-3 text-sm text-gray-300">{formatShortDate(p.convertedAt || p.createdAt)}</td>
                        <td className="px-5 py-3 text-sm text-gray-400">{p.correlationMethod || '-'}</td>
                      </tr>
                    ))}
                    <tr className="bg-gray-900/30 font-semibold">
                      <td className="px-5 py-3 text-sm text-white">Total</td>
                      <td className="px-5 py-3 text-sm text-green-400 text-right">{formatCurrency(totalRevenue)}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Activity Timeline */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl">
            <div className="px-5 py-4 border-b border-gray-700/50">
              <h2 className="text-lg font-semibold text-white">Actividad</h2>
            </div>
            <div className="p-5 space-y-3 max-h-[600px] overflow-y-auto">
              {timeline.length === 0 && <p className="text-sm text-gray-500">Sin actividad registrada</p>}
              {timeline.slice(0, 100).map((item, i) => (
                <div key={i} className="flex gap-3">
                  {item.type === 'message' ? (
                    <>
                      {senderIcon(item.sender)}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white break-words">{item.text}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{formatDate(item.date)}</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-7 h-7 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                        <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1 p-2 bg-green-500/10 border border-green-500/20 rounded-lg">
                        <p className="text-sm text-green-400 font-medium">Compra: {item.product}</p>
                        <p className="text-sm text-white">{formatCurrency(item.amount)}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{formatDate(item.date)} - {item.method}</p>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CustomerDetailView;
