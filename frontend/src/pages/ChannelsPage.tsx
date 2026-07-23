import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Tv, RefreshCw, ListVideo, Radio, Blocks } from 'lucide-react';
import toast from 'react-hot-toast';
import { channelApi, transcodingApi, playlistApi, blueprintApi } from '../services/api';
import {
  Channel,
  TranscodingProfile,
  Playlist,
  ChannelBlueprint,
  SourceType,
  OutputType,
} from '../types';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import ChannelCard from '../components/ChannelCard';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const SOURCE_TYPES: SourceType[] = ['M3U8', 'MP4', 'RTMP', 'MPEGTS', 'SRT', 'UDP', 'HTTP'];

type ChannelCreateMode = 'live' | 'playlist' | 'blueprint';

const MODE_OPTIONS: Array<{
  id: ChannelCreateMode;
  label: string;
  description: string;
  icon: typeof Radio;
}> = [
  {
    id: 'live',
    label: 'Live Feed',
    description: 'Stream from RTMP, M3U8, or other URL',
    icon: Radio,
  },
  {
    id: 'playlist',
    label: 'Playlist',
    description: 'Play videos in fixed playlist order',
    icon: ListVideo,
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    description: 'Dynamic channel behavior — movies, promos, rules',
    icon: Blocks,
  },
];

const ChannelsPage: React.FC = () => {
  const navigate = useNavigate();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [profiles, setProfiles] = useState<TranscodingProfile[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [blueprints, setBlueprints] = useState<ChannelBlueprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);

  const [formName, setFormName] = useState('');
  const [formMode, setFormMode] = useState<ChannelCreateMode>('playlist');
  const [formSourceUrl, setFormSourceUrl] = useState('');
  const [formSourceType, setFormSourceType] = useState<SourceType>('M3U8');
  const [formTranscodingProfileId, setFormTranscodingProfileId] = useState('');
  const [formAutoReconnect, setFormAutoReconnect] = useState(true);
  const [formPlaylistId, setFormPlaylistId] = useState('');
  const [formBlueprintId, setFormBlueprintId] = useState('');
  const [formOutputType, setFormOutputType] = useState<OutputType>('HLS');
  const [formEnableDvr, setFormEnableDvr] = useState(false);
  const [formDvrWindowMinutes, setFormDvrWindowMinutes] = useState(1440);

  const fetchData = async () => {
    try {
      const [channelRes, profileRes, playlistRes, blueprintRes] = await Promise.all([
        channelApi.getAll(),
        transcodingApi.getAll(),
        playlistApi.getAll(),
        blueprintApi.getAll(),
      ]);
      setChannels(channelRes.data || []);
      setProfiles(profileRes.data || []);
      setPlaylists(playlistRes.data || []);
      setBlueprints(blueprintRes.data || []);
    } catch {
      toast.error('Failed to load channels');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const resetForm = () => {
    setFormName('');
    setFormMode('playlist');
    setFormSourceUrl('');
    setFormSourceType('M3U8');
    setFormTranscodingProfileId('');
    setFormAutoReconnect(true);
    setFormPlaylistId('');
    setFormBlueprintId('');
    setFormOutputType('HLS');
    setFormEnableDvr(false);
    setFormDvrWindowMinutes(1440);
  };

  const selectCreateMode = (mode: ChannelCreateMode) => {
    setFormMode(mode);
    if (mode === 'blueprint') setFormPlaylistId('');
    if (mode === 'playlist') setFormBlueprintId('');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formName.trim()) {
      toast.error('Channel name is required');
      return;
    }

    if (formMode === 'live' && !formSourceUrl.trim() && formSourceType !== 'RTMP') {
      toast.error('Source URL is required for live feed mode');
      return;
    }

    if (formMode === 'playlist' && !formPlaylistId) {
      toast.error('Please select a playlist');
      return;
    }

    if (formMode === 'blueprint' && !formBlueprintId) {
      toast.error('Please select a blueprint');
      return;
    }

    setCreating(true);
    try {
      const payload: Record<string, unknown> = {
        name: formName.trim(),
        outputType: formOutputType,
        enableDvr: formEnableDvr,
        dvrWindowMinutes: formDvrWindowMinutes,
        autoReconnect: formAutoReconnect,
      };

      if (formTranscodingProfileId) {
        payload.transcodingProfileId = formTranscodingProfileId;
      }

      if (formMode === 'live') {
        payload.isPlaylistChannel = false;
        payload.useBlueprint = false;
        payload.sourceType = formSourceType;
        if (formSourceUrl.trim()) {
          payload.sourceUrl = formSourceUrl.trim();
        }
      } else if (formMode === 'playlist') {
        payload.isPlaylistChannel = true;
        payload.useBlueprint = false;
        payload.sourceType = 'MP4';
        payload.playlistId = formPlaylistId;
      } else {
        payload.isPlaylistChannel = true;
        payload.useBlueprint = true;
        payload.blueprintId = formBlueprintId;
        payload.sourceType = 'MP4';
      }

      await channelApi.create(payload);
      toast.success(
        formMode === 'blueprint'
          ? 'Blueprint channel created — start it when ready'
          : 'Channel created successfully'
      );
      setShowCreateModal(false);
      resetForm();
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.response?.data?.message || 'Failed to create channel');
    } finally {
      setCreating(false);
    }
  };

  const handleChannelClick = (channel: Channel) => {
    navigate(`/channels/${channel.id}`);
  };

  const handleDeleteChannel = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this channel?')) return;
    try {
      await channelApi.delete(id);
      toast.success('Channel deleted successfully');
      fetchData();
    } catch {
      toast.error('Failed to delete channel');
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
          title="Channels"
          description={`${channels.length} channel${channels.length !== 1 ? 's' : ''}`}
          actions={
            <>
              <Button variant="outline" onClick={() => fetchData()}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
              <Button onClick={() => setShowCreateModal(true)} className="flex-1 sm:flex-none">
                <Plus className="h-4 w-4" />
                Create Channel
              </Button>
            </>
          }
        />

        {channels.length === 0 ? (
          <EmptyState
            icon={<Tv className="h-12 w-12" />}
            title="No channels yet"
            description="Create your first channel to start streaming"
            action={
              <Button onClick={() => setShowCreateModal(true)}>
                <Plus className="h-4 w-4" />
                Create Channel
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {channels.map((channel) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                onClick={() => handleChannelClick(channel)}
                onDelete={(e) => handleDeleteChannel(channel.id, e)}
              />
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          resetForm();
        }}
        title="Create Channel"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="channel-name">Channel Name</Label>
            <Input
              id="channel-name"
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="My Channel"
            />
          </div>

          <div>
            <Label className="mb-2 block">Channel Type</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {MODE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const selected = formMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => selectCreateMode(opt.id)}
                    className={cn(
                      'rounded-lg border p-3 text-left transition',
                      selected
                        ? 'border-foreground/30 bg-secondary'
                        : 'border-border bg-card hover:border-border'
                    )}
                  >
                    <Icon
                      className={cn('mb-1.5 h-4 w-4', selected ? 'text-primary' : 'text-muted-foreground')}
                    />
                    <p className={cn('text-sm font-medium', selected ? 'text-foreground' : 'text-muted-foreground')}>
                      {opt.label}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{opt.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {formMode === 'playlist' && (
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">Playlist</label>
              <select
                value={formPlaylistId}
                onChange={(e) => setFormPlaylistId(e.target.value)}
                className="w-full px-3 py-2 bg-[#111111] border border-[#333333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm"
              >
                <option value="">Select playlist…</option>
                {playlists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p._count?.items ?? p.items?.length ?? 0} items)
                  </option>
                ))}
              </select>
            </div>
          )}

          {formMode === 'blueprint' && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">Blueprint</label>
                <select
                  value={formBlueprintId}
                  onChange={(e) => setFormBlueprintId(e.target.value)}
                  className="w-full px-3 py-2 bg-[#111111] border border-violet-900/40 rounded-md text-white focus:outline-none focus:border-violet-500 text-sm"
                >
                  <option value="">Select blueprint…</option>
                  {blueprints.map((bp) => (
                    <option key={bp.id} value={bp.id}>
                      {bp.name}
                      {bp.channel ? ` (on ${bp.channel.name})` : ''}
                    </option>
                  ))}
                </select>
                {blueprints.length === 0 && (
                  <p className="text-xs text-amber-500/90 mt-1.5">
                    No blueprints yet — create one under Blueprint first.
                  </p>
                )}
                {formBlueprintId && blueprints.find((b) => b.id === formBlueprintId)?.channel && (
                  <p className="text-xs text-amber-500/90 mt-1.5">
                    This blueprint is on another channel — it will be moved here on create.
                  </p>
                )}
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">
                Blueprint channels use block rules (movies, promos, transitions). Assign playlists inside each
                blueprint block — not here.
              </p>
            </div>
          )}

          {formMode === 'live' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">Live Source URL</label>
                <input
                  type="text"
                  value={formSourceUrl}
                  onChange={(e) => setFormSourceUrl(e.target.value)}
                  placeholder={
                    formSourceType === 'RTMP'
                      ? 'Optional for RTMP (auto: rtmp://nginx-rtmp:1936/live/<channel-slug>)'
                      : 'rtmp://example.com/live/stream'
                  }
                  className="w-full px-3 py-2 bg-[#111111] border border-[#333333] rounded-md text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 text-sm"
                />
                {formSourceType === 'RTMP' ? (
                  <p className="text-xs text-gray-600 mt-1">
                    OBS publish: <code className="text-gray-400">rtmp://YOUR_IP:1936/live</code> + stream key{' '}
                    <code className="text-gray-400">{'{channel-slug}'}</code>
                  </p>
                ) : (
                  <p className="text-xs text-gray-600 mt-1">Enter a URL for the live feed</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">Source Type</label>
                <select
                  value={formSourceType}
                  onChange={(e) => setFormSourceType(e.target.value as SourceType)}
                  className="w-full px-3 py-2 bg-[#111111] border border-[#333333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm"
                >
                  {SOURCE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Transcoding Profile</label>
            <select
              value={formTranscodingProfileId}
              onChange={(e) => setFormTranscodingProfileId(e.target.value)}
              className="w-full px-3 py-2 bg-[#111111] border border-[#333333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm"
            >
              <option value="">None (passthrough)</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.resolution})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Output Protocol</label>
            <select
              value={formOutputType}
              onChange={(e) => setFormOutputType(e.target.value as OutputType)}
              className="w-full bg-[#111] border border-[#333] rounded p-2 text-white text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="HLS">HLS (HTTP Live Streaming)</option>
              <option value="DASH">DASH (Dynamic Adaptive Streaming)</option>
            </select>
          </div>

          <div className="flex items-center gap-2 mt-4">
            <input
              type="checkbox"
              id="enableDvr"
              checked={formEnableDvr}
              onChange={(e) => setFormEnableDvr(e.target.checked)}
              className="w-4 h-4 rounded border-[#333] bg-[#111] text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-900"
            />
            <label htmlFor="enableDvr" className="text-sm font-medium text-gray-400">
              Enable DVR (Time-Shift)
            </label>
          </div>

          {formEnableDvr && (
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">DVR Window Size (minutes)</label>
              <input
                type="number"
                value={formDvrWindowMinutes}
                onChange={(e) => setFormDvrWindowMinutes(parseInt(e.target.value) || 10)}
                className="w-full bg-[#111] border border-[#333] rounded p-2 text-white text-sm focus:outline-none focus:border-blue-500"
                min="1"
              />
            </div>
          )}

          <div className="flex items-center gap-2 mt-4">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formAutoReconnect}
                onChange={(e) => setFormAutoReconnect(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[#333333] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-500 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-white peer-checked:after:bg-black" />
            </label>
            <span className="text-sm text-gray-400">Auto Reconnect</span>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowCreateModal(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? 'Creating...' : 'Create Channel'}
            </Button>
          </div>
        </form>
      </Modal>
    </Layout>
  );
};

export default ChannelsPage;
