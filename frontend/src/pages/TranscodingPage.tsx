import React, { useEffect, useState } from 'react';
import { Plus, Settings, Pencil, Trash2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { transcodingApi } from '../services/api';
import { TranscodingProfile, Resolution } from '../types';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';

const RESOLUTIONS: Resolution[] = ['RES_1080P', 'RES_720P', 'RES_480P'];
const PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];
const VIDEO_CODECS = [
  { value: 'libx264', label: 'CPU (libx264)' },
  { value: 'h264_nvenc', label: 'NVIDIA GPU (h264_nvenc)' },
  { value: 'h264_qsv', label: 'Intel QuickSync (h264_qsv)' },
  { value: 'h264_vaapi', label: 'VAAPI (h264_vaapi)' },
];

const resolutionLabel = (res: Resolution): string => {
  switch (res) {
    case 'RES_1080P': return '1080p (1920×1080)';
    case 'RES_720P': return '720p (1280×720)';
    case 'RES_480P': return '480p (854×480)';
    default: return res;
  }
};

const TranscodingPage: React.FC = () => {
  const [profiles, setProfiles] = useState<TranscodingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<TranscodingProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formResolution, setFormResolution] = useState<Resolution>('RES_720P');
  const [formVideoBitrate, setFormVideoBitrate] = useState('2500');
  const [formAudioBitrate, setFormAudioBitrate] = useState('128');
  const [formFps, setFormFps] = useState('30');
  const [formPreset, setFormPreset] = useState('fast');
  const [formVideoCodec, setFormVideoCodec] = useState('libx264');

  const fetchProfiles = async () => {
    try {
      const res = await transcodingApi.getAll();
      setProfiles(res.data || []);
    } catch {
      toast.error('Failed to load transcoding profiles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfiles();
  }, []);

  const resetForm = () => {
    setFormName('');
    setFormResolution('RES_720P');
    setFormVideoBitrate('2500');
    setFormAudioBitrate('128');
    setFormFps('30');
    setFormPreset('fast');
    setFormVideoCodec('libx264');
    setEditingProfile(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (profile: TranscodingProfile) => {
    setEditingProfile(profile);
    setFormName(profile.name);
    setFormResolution(profile.resolution);
    setFormVideoBitrate(String(profile.videoBitrate || 2500));
    setFormAudioBitrate(String(profile.audioBitrate || 128));
    setFormFps(String(profile.fps || 30));
    setFormPreset(profile.preset || 'fast');
    setFormVideoCodec(profile.videoCodec || 'libx264');
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      toast.error('Profile name is required');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: formName.trim(),
        resolution: formResolution,
        videoBitrate: parseInt(formVideoBitrate) || 2500,
        audioBitrate: parseInt(formAudioBitrate) || 128,
        fps: parseInt(formFps) || 30,
        preset: formPreset,
        videoCodec: formVideoCodec,
        audioCodec: 'aac',
      };

      if (editingProfile) {
        await transcodingApi.update(editingProfile.id, payload);
        toast.success('Profile updated');
      } else {
        await transcodingApi.create(payload);
        toast.success('Profile created');
      }

      setShowModal(false);
      resetForm();
      fetchProfiles();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await transcodingApi.delete(deleteId);
      toast.success('Profile deleted');
      setDeleteId(null);
      fetchProfiles();
    } catch {
      toast.error('Failed to delete profile');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <LoadingSpinner />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Transcoding Profiles"
          description={`${profiles.length} profile${profiles.length !== 1 ? 's' : ''}`}
          actions={
            <>
              <button
                onClick={fetchProfiles}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#222222] text-white text-sm rounded-md hover:bg-[#2a2a2a] border border-[#333333] transition-colors min-h-[44px]"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
              <button
                onClick={openCreateModal}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-black text-sm font-medium rounded-md hover:bg-gray-200 transition-colors min-h-[44px] flex-1 sm:flex-none"
              >
                <Plus className="w-4 h-4" />
                Create Profile
              </button>
            </>
          }
        />

        {/* Profiles Grid */}
        {profiles.length === 0 ? (
          <EmptyState
            icon={<Settings className="w-12 h-12" />}
            title="No transcoding profiles"
            description="Create a profile to define video output settings"
            action={
              <button
                onClick={openCreateModal}
                className="flex items-center gap-2 px-4 py-2 bg-white text-black text-sm font-medium rounded-md hover:bg-gray-200 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create Profile
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {profiles.map((profile) => (
              <div
                key={profile.id}
                className="bg-[#111111] border border-[#333333] rounded-lg p-5"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-white font-medium">{profile.name}</h3>
                    <p className="text-gray-500 text-xs mt-0.5">{resolutionLabel(profile.resolution)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditModal(profile)}
                      className="p-1.5 text-gray-500 hover:text-white hover:bg-[#222222] rounded transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setDeleteId(profile.id)}
                      className="p-1.5 text-gray-500 hover:text-red-500 hover:bg-[#222222] rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Video Bitrate</span>
                    <span className="text-gray-300">{profile.videoBitrate} kbps</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Audio Bitrate</span>
                    <span className="text-gray-300">{profile.audioBitrate} kbps</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">FPS</span>
                    <span className="text-gray-300">{profile.fps}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Preset</span>
                    <span className="text-gray-300">{profile.preset}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          resetForm();
        }}
        title={editingProfile ? 'Edit Profile' : 'Create Profile'}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Name</label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="720p Standard"
              className="w-full px-3 py-2 bg-[#111111] border border-[#333333] rounded-md text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Resolution</label>
            <select
              value={formResolution}
              onChange={(e) => setFormResolution(e.target.value as Resolution)}
              className="w-full px-3 py-2 bg-[#111111] border border-[#333333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm"
            >
              {RESOLUTIONS.map((res) => (
                <option key={res} value={res}>{resolutionLabel(res)}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">Video Bitrate (kbps)</label>
              <input
                type="number"
                value={formVideoBitrate}
                onChange={(e) => setFormVideoBitrate(e.target.value)}
                min="100"
                max="50000"
                className="w-full px-3 py-2 bg-[#111111] border border-[#333333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">Audio Bitrate (kbps)</label>
              <input
                type="number"
                value={formAudioBitrate}
                onChange={(e) => setFormAudioBitrate(e.target.value)}
                min="32"
                max="320"
                className="w-full px-3 py-2 bg-[#111111] border border-[#333333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Video encoder</label>
            <select
              value={formVideoCodec}
              onChange={(e) => setFormVideoCodec(e.target.value)}
              className="w-full px-3 py-2 bg-[#111111] border border-[#333333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm"
            >
              {VIDEO_CODECS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              GPU codecs need docker-compose.gpu.yml and an NVIDIA VPS. Use auto in .env or pick h264_nvenc here.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">FPS</label>
              <input
                type="number"
                value={formFps}
                onChange={(e) => setFormFps(e.target.value)}
                min="1"
                max="120"
                className="w-full px-3 py-2 bg-[#111111] border border-[#333333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">Preset</label>
              <select
                value={formPreset}
                onChange={(e) => setFormPreset(e.target.value)}
                className="w-full px-3 py-2 bg-[#111111] border border-[#333333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm"
              >
                {PRESETS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowModal(false);
                resetForm();
              }}
              className="px-4 py-2 bg-[#222222] text-white text-sm rounded-md hover:bg-[#2a2a2a] border border-[#333333] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-white text-black text-sm font-medium rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : editingProfile ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Profile"
        message="Are you sure you want to delete this transcoding profile? Channels using this profile will fall back to passthrough."
        confirmLabel={deleting ? 'Deleting...' : 'Delete'}
        loading={deleting}
      />
    </Layout>
  );
};

export default TranscodingPage;
