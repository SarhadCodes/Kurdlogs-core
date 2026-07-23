import { useEffect, useState } from 'react';
import { Palette, Plus, Trash2, Pencil } from 'lucide-react';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import { brandProfileApi } from '../services/api';
import type { BrandProfile } from '../types';
import toast from 'react-hot-toast';

const emptyForm = {
  name: '',
  x: 20,
  y: 20,
  width: 200,
  height: 200,
  opacity: 1,
  enabled: true,
};

export default function BrandProfilesPage() {
  const [rows, setRows] = useState<BrandProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BrandProfile | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await brandProfileApi.getAll();
      if (res.data) setRows(res.data);
    } catch {
      toast.error('Failed to load brand profiles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setLogoFile(null);
    setModalOpen(true);
  };

  const openEdit = (row: BrandProfile) => {
    setEditing(row);
    setForm({
      name: row.name,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      opacity: row.opacity,
      enabled: row.enabled,
    });
    setLogoFile(null);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('name', form.name);
      fd.append('x', String(form.x));
      fd.append('y', String(form.y));
      fd.append('width', String(form.width));
      fd.append('height', String(form.height));
      fd.append('opacity', String(form.opacity));
      fd.append('enabled', String(form.enabled));
      if (logoFile) fd.append('logo', logoFile);

      if (editing) {
        await brandProfileApi.update(editing.id, fd);
        toast.success('Brand profile updated');
      } else {
        if (!logoFile) {
          toast.error('Logo image is required for new profiles');
          setBusy(false);
          return;
        }
        await brandProfileApi.create(fd);
        toast.success('Brand profile created');
      }
      setModalOpen(false);
      await load();
    } catch (e: any) {
      toast.error(e?.error || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this brand profile?')) return;
    try {
      await brandProfileApi.delete(id);
      toast.success('Deleted');
      await load();
    } catch {
      toast.error('Delete failed');
    }
  };

  if (loading) return <Layout><LoadingSpinner /></Layout>;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <Palette className="w-6 h-6" /> Brand Profiles
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              Static logos applied during upload — not at stream runtime
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white text-black rounded-md text-sm font-medium hover:bg-gray-200"
          >
            <Plus className="w-4 h-4" /> New profile
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rows.map((row) => (
            <div key={row.id} className="bg-[#111] border border-[#333] rounded-lg p-4">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <h3 className="font-medium text-white">{row.name}</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    {row.width}×{row.height} @ ({row.x},{row.y}) · opacity {row.opacity}
                  </p>
                  <span
                    className={`inline-block mt-2 text-xs px-2 py-0.5 rounded ${
                      row.enabled ? 'bg-emerald-900/40 text-emerald-400' : 'bg-gray-800 text-gray-500'
                    }`}
                  >
                    {row.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => openEdit(row)} className="p-2 text-gray-400 hover:text-white">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => handleDelete(row.id)} className="p-2 text-gray-400 hover:text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="text-gray-500 col-span-full text-center py-12">No brand profiles yet</p>
          )}
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-[#111] border border-[#333] rounded-lg w-full max-w-md p-5 space-y-4">
            <h2 className="text-lg font-semibold text-white">{editing ? 'Edit' : 'New'} brand profile</h2>
            <label className="block text-sm text-gray-400">
              Name
              <input
                className="mt-1 w-full bg-black border border-[#333] rounded px-3 py-2 text-white"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="block text-sm text-gray-400">
              Logo {editing ? '(optional replace)' : ''}
              <input
                type="file"
                accept="image/*"
                className="mt-1 w-full text-sm text-gray-400"
                onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              {(['x', 'y', 'width', 'height', 'opacity'] as const).map((key) => (
                <label key={key} className="block text-sm text-gray-400 capitalize">
                  {key}
                  <input
                    type="number"
                    step={key === 'opacity' ? 0.1 : 1}
                    className="mt-1 w-full bg-black border border-[#333] rounded px-3 py-2 text-white"
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: parseFloat(e.target.value) || 0 })}
                  />
                </label>
              ))}
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-gray-400">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="accent-white"
              />
              Enabled
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-gray-400">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleSave}
                className="px-4 py-2 bg-white text-black rounded text-sm font-medium disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
