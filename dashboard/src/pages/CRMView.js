import React, { useState, useEffect, useCallback } from 'react';
import API from '../api';
import { useAuth } from '../contexts/AuthContext';
import ManualSaleForm from '../components/ManualSaleForm';

const inputClass = "w-full px-3 py-1.5 bg-gray-900/50 border border-gray-600/50 rounded text-white text-sm focus:outline-none focus:border-purple-500/50";

function CRMView() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';

  const [customers, setCustomers] = useState([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });
  const [search, setSearch] = useState('');

  // CRUD state
  const [editingPsid, setEditingPsid] = useState(null);
  const [editForm, setEditForm] = useState({ crmName: '', crmPhone: '', crmEmail: '', zipCode: '' });
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ crmName: '', crmPhone: '', crmEmail: '', zipCode: '' });
  const [saving, setSaving] = useState(false);
  const [deletingPsid, setDeletingPsid] = useState(null);
  const [salePsid, setSalePsid] = useState(null);

  const fetchCustomers = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page, limit: 30 });
      if (search) params.set('search', search);
      const res = await API.get(`/crm/customers?${params}`);
      setCustomers(res.data.customers || []);
      setPagination(res.data.pagination || { total: 0, pages: 1 });
    } catch (err) {
      console.error('Error fetching CRM customers:', err);
    } finally {
      setInitialLoad(false);
    }
  }, [page, search]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const toTitleCase = (str) => {
    if (!str) return str;
    return str.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  };

  // Edit
  const startEdit = (c) => {
    setEditingPsid(c.psid);
    setEditForm({ crmName: c.crmName || '', crmPhone: c.crmPhone || '', crmEmail: c.crmEmail || '', zipCode: c.zipCode || '' });
    setShowAdd(false);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await API.put(`/crm/customers/${encodeURIComponent(editingPsid)}/profile`, editForm);
      setEditingPsid(null);
      fetchCustomers();
    } catch (err) {
      console.error('Error updating customer:', err);
    } finally {
      setSaving(false);
    }
  };

  // Create
  const saveNew = async () => {
    if (!addForm.crmName.trim() && !addForm.crmPhone.trim() && !addForm.crmEmail.trim()) return;
    setSaving(true);
    try {
      await API.post('/crm/customers', addForm);
      setShowAdd(false);
      setAddForm({ crmName: '', crmPhone: '', crmEmail: '', zipCode: '' });
      fetchCustomers();
    } catch (err) {
      console.error('Error creating customer:', err);
    } finally {
      setSaving(false);
    }
  };

  // Delete
  const confirmDelete = async (psid) => {
    setSaving(true);
    try {
      await API.delete(`/crm/customers/${encodeURIComponent(psid)}`);
      setDeletingPsid(null);
      fetchCustomers();
    } catch (err) {
      console.error('Error deleting customer:', err);
    } finally {
      setSaving(false);
    }
  };

  if (initialLoad) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Clientes</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">{pagination.total} registrados</span>
          <button
            onClick={() => { setShowAdd(true); setEditingPsid(null); }}
            className="px-3 py-1.5 rounded-lg text-sm bg-purple-600 hover:bg-purple-500 text-white font-medium"
          >+ Agregar</button>
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Buscar por nombre, teléfono, email o ciudad..."
        className="w-full max-w-md px-4 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-purple-500/50"
      />

      {/* Add form */}
      {showAdd && (
        <div className="bg-gray-800/50 border border-purple-500/30 rounded-xl p-4">
          <h3 className="text-sm font-medium text-white mb-3">Nuevo cliente</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input type="text" placeholder="Nombre" value={addForm.crmName}
              onChange={(e) => setAddForm(f => ({ ...f, crmName: e.target.value }))} className={inputClass} />
            <input type="text" placeholder="Teléfono" value={addForm.crmPhone}
              onChange={(e) => setAddForm(f => ({ ...f, crmPhone: e.target.value }))} className={inputClass} />
            <input type="email" placeholder="Email" value={addForm.crmEmail}
              onChange={(e) => setAddForm(f => ({ ...f, crmEmail: e.target.value }))} className={inputClass} />
            <input type="text" placeholder="Código postal" value={addForm.zipCode}
              onChange={(e) => setAddForm(f => ({ ...f, zipCode: e.target.value }))} className={inputClass} />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={saveNew} disabled={saving || (!addForm.crmName.trim() && !addForm.crmPhone.trim() && !addForm.crmEmail.trim())}
              className="px-3 py-1.5 rounded text-sm bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40">
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button onClick={() => setShowAdd(false)}
              className="px-3 py-1.5 rounded text-sm bg-gray-700/50 text-gray-300 hover:bg-gray-600/50">Cancelar</button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deletingPsid && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4 flex items-center justify-between">
          <span className="text-sm text-red-300">Eliminar datos de CRM de este cliente?</span>
          <div className="flex gap-2">
            <button onClick={() => confirmDelete(deletingPsid)} disabled={saving}
              className="px-3 py-1.5 rounded text-sm bg-red-600 hover:bg-red-500 text-white disabled:opacity-40">
              {saving ? 'Eliminando...' : 'Confirmar'}
            </button>
            <button onClick={() => setDeletingPsid(null)}
              className="px-3 py-1.5 rounded text-sm bg-gray-700/50 text-gray-300 hover:bg-gray-600/50">Cancelar</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-900/50">
              <tr className="text-left text-xs text-gray-400 uppercase">
                <th className="px-6 py-3">Nombre</th>
                <th className="px-6 py-3">Teléfono</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Ciudad</th>
                <th className="px-4 py-3 w-24">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {customers.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-500">No hay clientes registrados</td></tr>
              ) : customers.map((c) => (
                editingPsid === c.psid ? (
                  <tr key={c.psid} className="bg-gray-700/10">
                    <td className="px-6 py-2"><input type="text" value={editForm.crmName}
                      onChange={(e) => setEditForm(f => ({ ...f, crmName: e.target.value }))} className={inputClass} /></td>
                    <td className="px-6 py-2"><input type="text" value={editForm.crmPhone}
                      onChange={(e) => setEditForm(f => ({ ...f, crmPhone: e.target.value }))} className={inputClass} /></td>
                    <td className="px-6 py-2"><input type="email" value={editForm.crmEmail}
                      onChange={(e) => setEditForm(f => ({ ...f, crmEmail: e.target.value }))} className={inputClass} /></td>
                    <td className="px-6 py-2"><input type="text" value={editForm.zipCode}
                      onChange={(e) => setEditForm(f => ({ ...f, zipCode: e.target.value }))} className={inputClass} /></td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        <button onClick={saveEdit} disabled={saving} title="Guardar"
                          className="p-1.5 rounded hover:bg-green-500/20 text-green-400 disabled:opacity-40">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                        <button onClick={() => setEditingPsid(null)} title="Cancelar"
                          className="p-1.5 rounded hover:bg-gray-500/20 text-gray-400">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <React.Fragment key={c.psid}>
                  <tr className="hover:bg-gray-700/20">
                    <td className="px-6 py-3 text-sm text-white font-medium">{toTitleCase(c.crmName) || '-'}</td>
                    <td className="px-6 py-3 text-sm text-gray-300">{c.crmPhone || '-'}</td>
                    <td className="px-6 py-3 text-sm text-gray-300">{c.crmEmail || '-'}</td>
                    <td className="px-6 py-3 text-sm text-gray-300">
                      {[c.city, c.stateMx].filter(Boolean).join(', ') || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => setSalePsid(salePsid === c.psid ? null : c.psid)} title="Registrar venta"
                          className={`p-1.5 rounded hover:bg-green-500/20 ${salePsid === c.psid ? 'text-green-300 bg-green-500/20' : 'text-green-400'}`}>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>
                        <button onClick={() => startEdit(c)} title="Editar"
                          className="p-1.5 rounded hover:bg-blue-500/20 text-blue-400">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        {isSuperAdmin && (
                          <button onClick={() => setDeletingPsid(c.psid)} title="Eliminar"
                            className="p-1.5 rounded hover:bg-red-500/20 text-red-400">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {salePsid === c.psid && (
                    <tr key={`${c.psid}-sale`}>
                      <td colSpan={5} className="px-6 py-4 bg-gray-800/80">
                        <ManualSaleForm
                          psid={c.psid}
                          channel={c.channel || 'facebook'}
                          onClose={() => setSalePsid(null)}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
                )
              ))}
            </tbody>
          </table>
        </div>

        {pagination.pages > 1 && (
          <div className="px-6 py-4 border-t border-gray-700/50 flex items-center justify-between">
            <p className="text-sm text-gray-400">{pagination.total} clientes</p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 rounded text-sm bg-gray-700/50 text-gray-300 disabled:opacity-30 hover:bg-gray-600/50"
              >Anterior</button>
              <span className="px-3 py-1 text-sm text-gray-400">{page} / {pagination.pages}</span>
              <button
                onClick={() => setPage(p => Math.min(pagination.pages, p + 1))}
                disabled={page >= pagination.pages}
                className="px-3 py-1 rounded text-sm bg-gray-700/50 text-gray-300 disabled:opacity-30 hover:bg-gray-600/50"
              >Siguiente</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CRMView;
