import { useCallback, useEffect, useRef, useState } from 'react';
import { Radio, RotateCcw, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { hybridApi, playlistApi, type HybridChannelSnapshot } from '../services/api';
import { wsService } from '../services/websocket';
import type { Playlist, PlaylistItem } from '../types';
import LoadingSpinner from './LoadingSpinner';

interface HybridChannelPanelProps {
  channelId: string;
  channelSlug: string;
  isOnline: boolean;
}

const NORM_OPTIONS = ['OFF', 'ON', 'AUTO'] as const;
type NormMode = (typeof NORM_OPTIONS)[number];

export default function HybridChannelPanel({ channelId, channelSlug, isOnline }: HybridChannelPanelProps) {
  const [snapshot, setSnapshot] = useState<HybridChannelSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<string | null>(null);

  const [liveFeedUrl, setLiveFeedUrl] = useState('');
  const [stationIdVideoPath, setStationIdVideoPath] = useState('');
  const [stationPlaylistId, setStationPlaylistId] = useState('');
  const [stationPlaylistItemId, setStationPlaylistItemId] = useState('');
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistItems, setPlaylistItems] = useState<PlaylistItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [blueprintNormalization, setBlueprintNormalization] = useState<NormMode>('OFF');
  const [stationNormalization, setStationNormalization] = useState<NormMode>('OFF');
  const [liveNormalization, setLiveNormalization] = useState<NormMode>('AUTO');
  const wasTransitioning = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await hybridApi.getState(channelId);
      if (res.success && res.data) {
        setSnapshot(res.data);
        setLiveFeedUrl(res.data.liveFeedUrl ?? '');
        setStationIdVideoPath(res.data.stationIdVideoPath ?? '');
        setStationPlaylistId(res.data.stationIdPlaylistId ?? '');
        setStationPlaylistItemId(res.data.stationIdPlaylistItemId ?? '');
        setBlueprintNormalization(res.data.blueprintNormalization);
        setStationNormalization(res.data.stationNormalization);
        setLiveNormalization(res.data.liveNormalization);
        wasTransitioning.current = res.data.transitionInProgress;
      }
    } catch (err: unknown) {
      const msg = (err as { error?: string })?.error || 'Failed to load hybrid channel settings';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    load();
    playlistApi.getAll().then((res) => {
      if (res.success && res.data) setPlaylists(res.data);
    });
  }, [load]);

  useEffect(() => {
    if (!stationPlaylistId) {
      setPlaylistItems([]);
      return;
    }
    setLoadingItems(true);
    playlistApi
      .getById(stationPlaylistId)
      .then((res) => {
        if (res.success && res.data?.items) {
          setPlaylistItems(res.data.items.filter((item) => item.status === 'READY'));
        }
      })
      .finally(() => setLoadingItems(false));
  }, [stationPlaylistId]);

  useEffect(() => {
    const unsub = wsService.subscribe(
      'hybrid:state',
      (payload: { channelId: string; state: HybridChannelSnapshot & { error?: string } }) => {
        if (payload.channelId !== channelId) return;
        setSnapshot(payload.state);
        if (payload.state.error) {
          toast.error(payload.state.error);
        } else if (wasTransitioning.current && !payload.state.transitionInProgress) {
          if (payload.state.activeSource === 'LIVE') {
            toast.success('Now live');
          } else if (payload.state.activeSource === 'BLUEPRINT') {
            toast.success('Back on schedule');
          }
        }
        wasTransitioning.current = payload.state.transitionInProgress;
      }
    );
    return unsub;
  }, [channelId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const stationPath = stationIdVideoPath.trim();
      const stationEnabled = !!stationPath;
      const res = await hybridApi.updateConfig(channelId, {
        liveFeedUrl: liveFeedUrl.trim() || null,
        stationIdVideoPath: stationEnabled ? stationPath : null,
        stationIdPlaylistId: stationEnabled ? stationPlaylistId || null : null,
        stationIdPlaylistItemId: stationEnabled ? stationPlaylistItemId || null : null,
        blueprintNormalization,
        stationNormalization,
        liveNormalization,
      });
      if (res.success && res.data) {
        setSnapshot(res.data);
        toast.success('Hybrid channel settings saved');
      }
    } catch (err: unknown) {
      toast.error((err as { error?: string })?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveTransitionConfig = useCallback(async () => {
    const stationPath = stationIdVideoPath.trim();
    const stationEnabled = !!stationPath;
    await hybridApi.updateConfig(channelId, {
      liveFeedUrl: liveFeedUrl.trim() || null,
      stationIdVideoPath: stationEnabled ? stationPath : null,
      stationIdPlaylistId: stationEnabled ? stationPlaylistId || null : null,
      stationIdPlaylistItemId: stationEnabled ? stationPlaylistItemId || null : null,
      blueprintNormalization,
      stationNormalization,
      liveNormalization,
    });
  }, [
    channelId,
    liveFeedUrl,
    stationIdVideoPath,
    stationPlaylistId,
    stationPlaylistItemId,
    blueprintNormalization,
    stationNormalization,
    liveNormalization,
  ]);

  const handleGoLive = async () => {
    setAction('go-live');
    try {
      await saveTransitionConfig();
      const res = await hybridApi.goLive(channelId);
      if (res.success && res.data) {
        setSnapshot(res.data);
        wasTransitioning.current = true;
        toast.success('Switching sources…');
      }
    } catch (err: unknown) {
      toast.error((err as { error?: string })?.error || 'Go live failed');
    } finally {
      setAction(null);
    }
  };

  const handleReturn = async () => {
    setAction('return');
    try {
      await saveTransitionConfig();
      const res = await hybridApi.returnToSchedule(channelId);
      if (res.success && res.data) {
        setSnapshot(res.data);
        wasTransitioning.current = true;
        toast.success('Returning to schedule…');
      }
    } catch (err: unknown) {
      toast.error((err as { error?: string })?.error || 'Return failed');
    } finally {
      setAction(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <LoadingSpinner />
      </div>
    );
  }

  const sourceLabel =
    snapshot?.activeSource === 'LIVE'
      ? 'Live Feed'
      : snapshot?.activeSource === 'TRANSITION'
        ? 'Transitioning…'
        : 'Blueprint';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Radio className="w-4 h-4 text-amber-400" />
            Hybrid Channel
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Viewer URL stays <span className="font-mono text-gray-400">/stream/{channelSlug}/master.m3u8</span>
          </p>
        </div>
        <span
          className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
            snapshot?.activeSource === 'LIVE'
              ? 'border-red-500/40 bg-red-500/10 text-red-300'
              : 'border-violet-500/40 bg-violet-500/10 text-violet-300'
          }`}
        >
          On air: {sourceLabel}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-xs text-gray-400">Live feed URL (Flussonic HLS)</span>
          <input
            type="url"
            value={liveFeedUrl}
            onChange={(e) => setLiveFeedUrl(e.target.value)}
            placeholder="https://flussonic.example/live/event/index.m3u8"
            className="mt-1 w-full rounded-lg bg-[#1a1a1a] border border-[#333] px-3 py-2 text-sm text-white"
          />
        </label>

        <div className="block sm:col-span-2 space-y-2">
          <span className="text-xs text-gray-400">Station ID video (optional)</span>
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={stationPlaylistId}
              onChange={(e) => {
                setStationPlaylistId(e.target.value);
                setStationPlaylistItemId('');
                setStationIdVideoPath('');
              }}
              className="w-full rounded-lg bg-[#1a1a1a] border border-[#333] px-3 py-2 text-sm text-white"
            >
              <option value="">Select playlist…</option>
              {playlists.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.name}
                </option>
              ))}
            </select>
            <select
              value={stationPlaylistItemId}
              disabled={!stationPlaylistId || loadingItems}
              onChange={(e) => {
                const itemId = e.target.value;
                setStationPlaylistItemId(itemId);
                if (!itemId) {
                  setStationIdVideoPath('');
                  return;
                }
                const item = playlistItems.find((i) => i.id === itemId);
                const videoPath = item?.videoPath ?? '';
                setStationIdVideoPath(videoPath);
                if (videoPath) {
                  void hybridApi.updateConfig(channelId, {
                    stationIdPlaylistId: stationPlaylistId || null,
                    stationIdPlaylistItemId: itemId,
                    stationIdVideoPath: videoPath,
                  });
                }
              }}
              className="w-full rounded-lg bg-[#1a1a1a] border border-[#333] px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              <option value="">
                {loadingItems ? 'Loading videos…' : 'Select video…'}
              </option>
              {playlistItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.originalFilename}
                </option>
              ))}
            </select>
          </div>
          <input
            type="text"
            value={stationIdVideoPath}
            onChange={(e) => {
              const value = e.target.value;
              setStationIdVideoPath(value);
              if (!value.trim()) {
                setStationPlaylistId('');
                setStationPlaylistItemId('');
              }
            }}
            placeholder="Or enter path manually: uploads/station-id.mp4"
            className="w-full rounded-lg bg-[#1a1a1a] border border-[#333] px-3 py-2 text-sm text-white"
          />
        </div>

        {(
          [
            ['Blueprint normalization', blueprintNormalization, setBlueprintNormalization],
            ['Station ID normalization', stationNormalization, setStationNormalization],
            ['Live feed normalization', liveNormalization, setLiveNormalization],
          ] as const
        ).map(([label, value, setter]) => (
          <label key={label} className="block">
            <span className="text-xs text-gray-400">{label}</span>
            <select
              value={value}
              onChange={(e) => setter(e.target.value as NormMode)}
              className="mt-1 w-full rounded-lg bg-[#1a1a1a] border border-[#333] px-3 py-2 text-sm text-white"
            >
              {NORM_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#2a2a2a] hover:bg-[#333] text-sm text-white disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving…' : 'Save settings'}
        </button>

        <button
          type="button"
          onClick={handleGoLive}
          disabled={!isOnline || !snapshot?.canGoLive || action !== null}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-sm text-white disabled:opacity-40"
        >
          <Radio className="w-4 h-4" />
          {action === 'go-live' ? 'Going live…' : 'Go Live'}
        </button>

        <button
          type="button"
          onClick={handleReturn}
          disabled={!isOnline || !snapshot?.canReturnToSchedule || action !== null}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-sm text-white disabled:opacity-40"
        >
          <RotateCcw className="w-4 h-4" />
          {action === 'return' ? 'Returning…' : 'Return To Schedule'}
        </button>
      </div>

      {!isOnline && (
        <p className="text-xs text-amber-500/90">Start the channel before switching sources.</p>
      )}
    </div>
  );
}
