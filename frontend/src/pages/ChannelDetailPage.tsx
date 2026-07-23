import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Play,
  Square,
  RotateCw,
  ArrowLeft,
  Settings,
  Activity,
  Layers,
  Wifi,
  WifiOff,
  Trash2,
  ArrowRightLeft,
  ListVideo,
  Radio,
  Link2,
  Eraser,
  Globe,
  Users,
  Blocks,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { channelApi, playlistApi, blueprintApi, monitorApi } from '../services/api';
import { Playlist, ChannelBlueprint } from '../types';
import { Channel, StreamStats, StreamLog, ChannelHealthReport } from '../types';
import { useChannelStore } from '../stores/channelStore';
import Layout from '../components/Layout';
import { buildStreamUrl, getPreviewManifestForEngine, getPlaylistVariantManifest } from '../utils/streamUrl';
import LoadingSpinner from '../components/LoadingSpinner';
import LivePlayer, {
  type LivePlayerHandle,
  type HlsQualityLevel,
  type StreamQualityInfo,
} from '../components/LivePlayer';
import PreviewTestPanel from '../components/PreviewTestPanel';
import HybridChannelPanel from '../components/HybridChannelPanel';
import ViewerMapFullscreen from '../components/ViewerMapFullscreen';
import type { ViewerLocation, ViewerMapPayload } from '../types/viewer';
import { wsService } from '../services/websocket';
import { useViewerHeartbeat } from '../hooks/useViewerHeartbeat';
import { setViewerStreamMeta } from '../utils/viewerSession';
import StatusBadge from '../components/StatusBadge';
import LogViewer from '../components/LogViewer';
import Modal from '../components/Modal';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  PLAYER_ENGINE_KEY,
  PLAYER_ENGINE_OPTIONS,
  type PlayerEngine,
} from '../types/player';

function getChannelModeDisplay(channel: Channel) {
  if (channel.useBlueprint) {
    return { label: 'Blueprint', Icon: Blocks, color: 'text-muted-foreground' };
  }
  if (channel.isPlaylistChannel) {
    return { label: 'Playlist', Icon: ListVideo, color: 'text-muted-foreground' };
  }
  return { label: 'Live Feed', Icon: Radio, color: 'text-muted-foreground' };
}

const ChannelDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { stats, updateChannelStats } = useChannelStore();

  const [channel, setChannel] = useState<Channel | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [logs, setLogs] = useState<StreamLog[]>([]);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [channelStats, setChannelStats] = useState<StreamStats | null>(null);
  const [previewQuality, setPreviewQuality] = useState<StreamQualityInfo | null>(null);
  const [previewToolsOpen, setPreviewToolsOpen] = useState(false);
  const [hlsLevels, setHlsLevels] = useState<HlsQualityLevel[]>([]);
  const [selectedQualityLevel, setSelectedQualityLevel] = useState(-1);
  const [canManualQuality, setCanManualQuality] = useState(false);
  const [previewVideo, setPreviewVideo] = useState<HTMLVideoElement | null>(null);
  const livePlayerRef = useRef<LivePlayerHandle>(null);
  const [viewers, setViewers] = useState(0);
  const [viewerLocations, setViewerLocations] = useState<ViewerLocation[]>([]);
  const [viewerMapOpen, setViewerMapOpen] = useState(false);

  const [showSwitchModal, setShowSwitchModal] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [switchPlaylistId, setSwitchPlaylistId] = useState('');
  const [switchSourceUrl, setSwitchSourceUrl] = useState('');
  const [switchSourceType, setSwitchSourceType] = useState('RTMP');
  const [switching, setSwitching] = useState(false);
  const [playerEngine, setPlayerEngine] = useState<PlayerEngine>(() => {
    const saved = localStorage.getItem(PLAYER_ENGINE_KEY);
    if (saved && PLAYER_ENGINE_OPTIONS.some((o) => o.id === saved)) {
      return saved as PlayerEngine;
    }
    return 'auto';
  });
  const [blueprints, setBlueprints] = useState<ChannelBlueprint[]>([]);
  const [playbackModeBusy, setPlaybackModeBusy] = useState(false);
  const [selectedBlueprintId, setSelectedBlueprintId] = useState('');
  const [livePlayback, setLivePlayback] = useState<ChannelHealthReport['playback'] | null>(null);

  const fetchChannel = useCallback(async () => {
    if (!id) return;
    try {
      const res = await channelApi.getById(id);
      setChannel(res.data || null);
    } catch (err: any) {
      toast.error('Failed to load channel');
      navigate('/channels');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  const fetchStats = useCallback(async () => {
    if (!id) return;
    try {
      const res = await channelApi.getStats(id);
      if (res.data) {
        setChannelStats(res.data);
        updateChannelStats(id, res.data);
      }
    } catch {
      // Stats may not be available when channel is offline
    }
  }, [id, updateChannelStats]);

  const fetchLogs = useCallback(async () => {
    if (!id) return;
    try {
      const res = await channelApi.getLogs(id);
      setLogs(res.data || []);
    } catch {
      // Logs may not be available
    }
  }, [id]);

  const fetchLivePlayback = useCallback(async () => {
    if (!id) return;
    try {
      const res = await monitorApi.getChannelHealth();
      const row = (res.data || []).find((c) => c.channelId === id);
      const playback = row?.playback ?? null;
      setLivePlayback(playback);
      if (import.meta.env.DEV && playback?.currentAsset) {
        console.info(
          `[NOW_PLAYING_STATE] source=monitoring/health currentMedia=${playback.currentAsset} ` +
            `playbackSource=${playback.playbackSource}`
        );
      }
    } catch {
      setLivePlayback(null);
    }
  }, [id]);

  useEffect(() => {
    fetchChannel();
    fetchStats();
    fetchLogs();
    fetchLivePlayback();
    blueprintApi.getAll().then((res) => {
      if (res.data) setBlueprints(res.data);
    }).catch(() => {});

    const interval = setInterval(() => {
      fetchStats();
      fetchLogs();
      fetchLivePlayback();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchChannel, fetchStats, fetchLogs, fetchLivePlayback]);

  useEffect(() => {
    if (channel?.blueprintId) setSelectedBlueprintId(channel.blueprintId);
  }, [channel?.blueprintId]);

  useEffect(() => {
    if (!id) return;
    const unsubCount = wsService.subscribe('viewer:count', (counts: Record<string, number>) => {
      setViewers(counts[id] || 0);
    });
    const unsubMap = wsService.subscribe('viewer:map', (payload: ViewerMapPayload) => {
      setViewerLocations(payload.channels[id] || []);
    });
    return () => {
      unsubCount();
      unsubMap();
    };
  }, [id]);

  const [hybridSwitchEpoch, setHybridSwitchEpoch] = useState(0);

  useEffect(() => {
    if (!id) return;
    const unsub = wsService.subscribe(
      'hybrid:state',
      (payload: { channelId: string }) => {
        if (payload.channelId !== id) return;
        setHybridSwitchEpoch((n) => n + 1);
      }
    );
    return unsub;
  }, [id]);

  useViewerHeartbeat(id, channel?.status === 'ONLINE');

  useEffect(() => {
    if (channel?.status !== 'ONLINE') return;
    setViewerStreamMeta({
      quality: previewQuality?.label,
      bitrateKbps:
        previewQuality?.bitrateKbps ??
        (channelStats?.bitrate ? Math.round(channelStats.bitrate / 1000) : undefined),
      player: 'KurdLogs Core',
    });
  }, [channel?.status, previewQuality, channelStats?.bitrate]);

  const handleAction = async (action: 'start' | 'stop' | 'restart') => {
    if (!id) return;
    setActionLoading(action);
    try {
      switch (action) {
        case 'start':
          await channelApi.start(id);
          toast.success('Channel starting...');
          break;
        case 'stop':
          await channelApi.stop(id);
          toast.success('Channel stopping...');
          break;
        case 'restart':
          await channelApi.restart(id);
          toast.success('Channel restarting...');
          break;
      }
      setTimeout(fetchChannel, 1500);
    } catch (err: any) {
      toast.error(`Failed to ${action} channel`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!id || !window.confirm('Are you sure you want to delete this channel?')) return;
    
    setActionLoading('delete');
    try {
      await channelApi.delete(id);
      toast.success('Channel deleted successfully');
      navigate('/channels');
    } catch (err: any) {
      toast.error('Failed to delete channel');
      setActionLoading(null);
    }
  };

  const handlePlayerEngineChange = (engine: PlayerEngine) => {
    setPlayerEngine(engine);
    localStorage.setItem(PLAYER_ENGINE_KEY, engine);
    setSelectedQualityLevel(-1);
    setHlsLevels([]);
  };

  const handleSelectQualityLevel = (levelIndex: number) => {
    setSelectedQualityLevel(levelIndex);
    livePlayerRef.current?.setQualityLevel(levelIndex);
  };

  useEffect(() => {
    if (channel?.status !== 'ONLINE') {
      setPreviewVideo(null);
      return;
    }
    const syncVideo = () => {
      setPreviewVideo(livePlayerRef.current?.getVideoElement() ?? null);
    };
    syncVideo();
    const t = window.setTimeout(syncVideo, 800);
    return () => window.clearTimeout(t);
  }, [channel?.status, playerEngine, previewToolsOpen, previewQuality]);

  const handleClearLogs = async () => {
    if (!id || clearingLogs) return;
    if (!window.confirm('Clear all recent logs for this channel?')) return;

    setClearingLogs(true);
    try {
      const res = await channelApi.clearLogs(id);
      setLogs([]);
      toast.success(`Cleared ${res.data?.deleted ?? 0} log entries`);
      await fetchLogs();
    } catch {
      toast.error('Failed to clear logs');
    } finally {
      setClearingLogs(false);
    }
  };

  const openSwitchModal = async () => {
    try {
      const res = await playlistApi.getAll();
      setPlaylists(res.data || []);
    } catch { /* ignore */ }
    if (channel) {
      setSwitchPlaylistId(channel.playlistId || '');
      setSwitchSourceUrl(channel.sourceUrl === 'internal-playlist' ? '' : (channel.sourceUrl || ''));
      setSwitchSourceType(channel.sourceType || 'RTMP');
    }
    setShowSwitchModal(true);
  };

  const handlePlaybackMode = async (mode: 'playlist' | 'blueprint') => {
    if (!id) return;
    if (mode === 'blueprint' && !selectedBlueprintId && !channel?.blueprintId) {
      toast.error('Select a blueprint first');
      return;
    }
    setPlaybackModeBusy(true);
    try {
      const bpId = mode === 'blueprint' ? (selectedBlueprintId || channel?.blueprintId || undefined) : undefined;
      const res = await channelApi.setPlaybackMode(id, mode, bpId);
      setChannel(res.data || null);
      toast.success(`Playback mode: ${mode === 'blueprint' ? 'Blueprint' : 'Playlist'}`);
    } catch (err: any) {
      toast.error(err?.error || err?.response?.data?.error || 'Failed to update playback mode');
    } finally {
      setPlaybackModeBusy(false);
    }
  };

  const handleSwitchMode = async (targetMode: 'playlist' | 'live') => {
    if (!id) return;
    if (targetMode === 'playlist' && !switchPlaylistId) {
      toast.error('Please select a playlist');
      return;
    }
    if (targetMode === 'live' && switchSourceType !== 'RTMP' && !switchSourceUrl.trim()) {
      toast.error('Please enter a source URL');
      return;
    }

    setSwitching(true);
    try {
      const payload: any = { mode: targetMode };
      if (targetMode === 'playlist') {
        payload.playlistId = switchPlaylistId;
      } else {
        if (switchSourceUrl.trim()) {
          payload.sourceUrl = switchSourceUrl.trim();
        }
        payload.sourceType = switchSourceType;
      }
      const res = await channelApi.switchMode(id, payload);
      setChannel(res.data || null);
      if (targetMode === 'playlist' && channel?.isPlaylistChannel) {
        toast.success('Playlist updated');
      } else if (targetMode === 'live' && channel && !channel.isPlaylistChannel) {
        toast.success('Live source updated');
      } else {
        toast.success(`Switched to ${targetMode === 'playlist' ? 'Playlist' : 'Live Feed'} mode`);
      }
      setShowSwitchModal(false);
    } catch (err: any) {
      toast.error(err?.message || `Failed to switch mode`);
    } finally {
      setSwitching(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <LoadingSpinner />
      </Layout>
    );
  }

  if (!channel) {
    return (
      <Layout>
        <div className="text-center py-20 text-gray-500">Channel not found</div>
      </Layout>
    );
  }

  const previewManifest =
    channel.isPlaylistChannel && playerEngine !== 'dashjs'
      ? getPlaylistVariantManifest(channel.transcodingProfile?.resolution)
      : getPreviewManifestForEngine(playerEngine);
  const streamUrl = buildStreamUrl(channel.slug, previewManifest);
  const currentStats = channelStats || (id ? stats[id] : null);
  const playlistUnchanged =
    channel.isPlaylistChannel && !!switchPlaylistId && switchPlaylistId === channel.playlistId;
  const liveSourceUrl =
    channel.sourceUrl === 'internal-playlist' ? '' : (channel.sourceUrl || '');
  const liveUnchanged =
    !channel.isPlaylistChannel &&
    switchSourceUrl.trim() === liveSourceUrl &&
    switchSourceType === channel.sourceType;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => navigate('/channels')}
              aria-label="Back to channels"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <h1 className="font-display text-xl font-semibold tracking-tight text-foreground break-words sm:text-2xl">
                  {channel.name}
                </h1>
                <StatusBadge status={channel.status} />
              </div>
              <p className="mt-0.5 font-mono text-sm text-muted-foreground break-all">/{channel.slug}</p>
            </div>
            {channel.status === 'ONLINE' && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setViewerMapOpen(true)}
                title="Open viewer map"
              >
                <Globe className="h-4 w-4 text-primary" />
                <Users className="h-4 w-4" />
                <span className="font-mono">{viewers}</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">viewers</span>
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary" className="flex-1 sm:flex-none">
              <Link to={`/channels/${id}/outputs`}>
                <Link2 className="h-4 w-4 shrink-0" />
                Output links
              </Link>
            </Button>
            <Button
              type="button"
              onClick={() => handleAction('start')}
              disabled={actionLoading !== null || channel.status === 'ONLINE'}
              className="flex-1 sm:flex-none"
            >
              {actionLoading === 'start' ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
              ) : (
                <Play className="h-4 w-4 shrink-0" />
              )}
              Start
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleAction('stop')}
              disabled={actionLoading !== null || channel.status === 'OFFLINE'}
              className="flex-1 sm:flex-none"
            >
              {actionLoading === 'stop' ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
              ) : (
                <Square className="h-4 w-4 shrink-0" />
              )}
              Stop
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleAction('restart')}
              disabled={actionLoading !== null || channel.status === 'OFFLINE'}
              className="flex-1 sm:flex-none"
            >
              {actionLoading === 'restart' ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
              ) : (
                <RotateCw className="h-4 w-4 shrink-0" />
              )}
              <span className="hidden sm:inline">Restart</span>
              <span className="sm:hidden">Retry</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={openSwitchModal}
              disabled={actionLoading !== null}
              className="flex-1 sm:flex-none"
              title={channel.isPlaylistChannel ? 'Switch to Live Feed' : 'Switch to Playlist'}
            >
              <ArrowRightLeft className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">Switch Mode</span>
              <span className="sm:hidden">Switch</span>
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={actionLoading !== null}
              className="w-full sm:w-auto"
            >
              {actionLoading === 'delete' ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-destructive-foreground/30 border-t-destructive-foreground" />
              ) : (
                <Trash2 className="h-4 w-4 shrink-0" />
              )}
              Delete
            </Button>
          </div>
        </div>

        <Tabs defaultValue="preview" className="w-full">
          <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-flex">
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="preview" className="mt-4">
            <Card className="overflow-hidden bg-card/80">
              <CardHeader className="flex flex-col gap-3 border-b border-border sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-sm font-medium">Preview</CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {PLAYER_ENGINE_OPTIONS.find((o) => o.id === playerEngine)?.description}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {PLAYER_ENGINE_OPTIONS.map((option) => (
                    <Button
                      key={option.id}
                      type="button"
                      size="sm"
                      variant={playerEngine === option.id ? 'default' : 'secondary'}
                      title={option.description}
                      onClick={() => handlePlayerEngineChange(option.id)}
                      className="h-8 px-2.5 text-xs"
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <div className="aspect-video bg-black">
                {channel.status === 'ONLINE' ? (
                  <LivePlayer
                    ref={livePlayerRef}
                    key={`${playerEngine}-${previewManifest}-${hybridSwitchEpoch}`}
                    src={streamUrl}
                    channelId={id}
                    engine={playerEngine}
                    forcedQualityLevel={selectedQualityLevel}
                    onQualityChange={setPreviewQuality}
                    onLevelsChange={setHlsLevels}
                    onCanManualQuality={setCanManualQuality}
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center text-muted-foreground">
                    <WifiOff className="mb-3 h-12 w-12" />
                    <p className="text-sm">Channel is {channel.status.toLowerCase()}</p>
                  </div>
                )}
              </div>
              {channel.status === 'ONLINE' && (
                <PreviewTestPanel
                  open={previewToolsOpen}
                  onToggle={() => setPreviewToolsOpen((v) => !v)}
                  currentQuality={previewQuality}
                  levels={hlsLevels}
                  selectedLevel={selectedQualityLevel}
                  onSelectLevel={handleSelectQualityLevel}
                  canManualQuality={canManualQuality && hlsLevels.length > 0}
                  video={previewVideo}
                />
              )}
            </Card>
          </TabsContent>

          <TabsContent value="logs" className="mt-4">
            <Card className="bg-card/80">
              <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border">
                <CardTitle className="text-sm font-medium">Recent Logs</CardTitle>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleClearLogs}
                  disabled={clearingLogs || logs.length === 0}
                >
                  {clearingLogs ? (
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                  ) : (
                    <Eraser className="h-3.5 w-3.5" />
                  )}
                  Clear all
                </Button>
              </CardHeader>
              <CardContent className="p-4">
                <LogViewer logs={logs} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings" className="mt-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Stream Details */}
            <div className="rounded-xl border border-border bg-card/80 p-4">
              <div className="mb-4 flex items-center gap-2">
                <Settings className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium text-foreground">Stream Details</h3>
              </div>
              <div className="space-y-3">
                <DetailRow
                  label="Current Mode"
                  value={(() => {
                    const mode = getChannelModeDisplay(channel);
                    const ModeIcon = mode.Icon;
                    return (
                      <span className="flex items-center gap-1.5">
                        <ModeIcon className={`h-3 w-3 ${mode.color}`} />
                        <span className={mode.color}>{mode.label}</span>
                      </span>
                    );
                  })()}
                />
                {channel.status === 'ONLINE' && livePlayback && (
                  <DetailRow
                    label="Live Playback"
                    value={
                      <span className="flex flex-col items-end gap-0.5">
                        <span
                          className={
                            livePlayback.playbackSource === 'BLUEPRINT'
                              ? 'font-medium text-foreground'
                              : 'font-medium text-foreground/80'
                          }
                        >
                          {livePlayback.playbackSource}
                          {livePlayback.blueprintName ? ` · ${livePlayback.blueprintName}` : ''}
                        </span>
                        {livePlayback.currentAsset && (
                          <span className="max-w-[180px] truncate text-xs text-muted-foreground" title={livePlayback.currentAsset}>
                            Now: {livePlayback.currentAsset}
                          </span>
                        )}
                      </span>
                    }
                  />
                )}
                {channel.isPlaylistChannel && (
                  <div className="space-y-3 border-t border-border pt-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Playback mode</p>
                    <div className="flex flex-col gap-2">
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="playbackMode"
                          checked={!channel.useBlueprint}
                          disabled={playbackModeBusy}
                          onChange={() => handlePlaybackMode('playlist')}
                          className="accent-primary"
                        />
                        <span className="text-foreground/80">Playlist</span>
                        <span className="text-xs text-muted-foreground">— fixed playlist order</span>
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="playbackMode"
                          checked={!!channel.useBlueprint}
                          disabled={playbackModeBusy}
                          onChange={() => handlePlaybackMode('blueprint')}
                          className="accent-primary"
                        />
                        <span className="text-foreground/80">Blueprint</span>
                        <span className="text-xs text-muted-foreground">— dynamic block engine</span>
                      </label>
                    </div>
                    {channel.useBlueprint && (
                      <select
                        value={selectedBlueprintId}
                        onChange={(e) => setSelectedBlueprintId(e.target.value)}
                        onBlur={() => {
                          if (selectedBlueprintId && selectedBlueprintId !== channel.blueprintId) {
                            handlePlaybackMode('blueprint');
                          }
                        }}
                        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
                      >
                        <option value="">Select blueprint…</option>
                        {blueprints.map((bp) => (
                          <option key={bp.id} value={bp.id}>
                            {bp.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {channel.useBlueprint && channel.blueprint?.name && (
                      <p className="text-xs text-muted-foreground">Active: {channel.blueprint.name}</p>
                    )}
                    {channel.useBlueprint && (
                      <div className="mt-4 border-t border-border pt-4">
                        <HybridChannelPanel
                          channelId={channel.id}
                          channelSlug={channel.slug}
                          isOnline={channel.status === 'ONLINE' || channel.status === 'STARTING'}
                        />
                      </div>
                    )}
                  </div>
                )}
                <DetailRow label="Source Type" value={channel.sourceType} />
                <DetailRow label="Source URL" value={channel.sourceUrl || 'N/A'} truncate />
                <DetailRow
                  label="Transcoding"
                  value={channel.transcodingProfileId ? 'Enabled' : 'Passthrough'}
                />
                <DetailRow
                  label="Auto Reconnect"
                  value={
                    <span className="flex items-center gap-1.5">
                      {channel.autoReconnect ? (
                        <Wifi className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <WifiOff className="h-3 w-3 text-muted-foreground" />
                      )}
                      {channel.autoReconnect ? 'Yes' : 'No'}
                    </span>
                  }
                />
                <DetailRow
                  label="Overlays"
                  value={
                    <span className="flex items-center gap-1.5">
                      <Layers className="h-3 w-3 text-muted-foreground" />
                      {channel.overlays?.length || 0}
                    </span>
                  }
                />
              </div>
            </div>

            {/* Live Stats */}
            <div className="rounded-xl border border-border bg-card/80 p-4">
              <div className="mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium text-foreground">Live Stats</h3>
              </div>
              {currentStats ? (
                <div className="space-y-3">
                  <StatRow
                    label="Bitrate"
                    value={`${currentStats.bitrate ? (currentStats.bitrate / 1000).toFixed(1) : '0'} kbps`}
                  />
                  <StatRow
                    label="FPS"
                    value={`${currentStats.fps || 0}`}
                  />
                  <StatRow
                    label="Uptime"
                    value={formatUptime(currentStats.uptime)}
                  />
                  {channel.status === 'ONLINE' && previewToolsOpen && (
                    <StatRow
                      label="Preview quality"
                      value={previewQuality?.label ?? '—'}
                    />
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {channel.status === 'ONLINE' ? 'Loading stats...' : 'No stats available (channel offline)'}
                </p>
              )}
            </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Switch Mode Modal */}
      <Modal
        isOpen={showSwitchModal}
        onClose={() => setShowSwitchModal(false)}
        title="Switch Channel Mode"
      >
        <div className="space-y-5">
          <p className="text-sm text-gray-400">
            Currently in{' '}
            <span className="font-medium text-white">{getChannelModeDisplay(channel).label}</span> mode.
            {channel.status === 'ONLINE' && (
              <span className="text-yellow-500 block mt-1">The channel is live and will restart when switching.</span>
            )}
          </p>

          {/* Switch to Playlist */}
          <div className="bg-[#0a0a0a] border border-[#333333] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <ListVideo className="w-4 h-4 text-blue-400" />
              <h4 className="text-sm font-medium text-white">Playlist Mode</h4>
              {channel.isPlaylistChannel && !channel.useBlueprint && (
                <span className="text-[10px] uppercase tracking-wider text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded">Active</span>
              )}
            </div>
            <select
              value={switchPlaylistId}
              onChange={(e) => setSwitchPlaylistId(e.target.value)}
              className="w-full px-3 py-2 bg-[#111111] border border-[#333333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm mb-3"
            >
              <option value="">Select playlist...</option>
              {playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p._count?.items ?? 0} items)
                </option>
              ))}
            </select>
            <button
              onClick={() => handleSwitchMode('playlist')}
              disabled={switching || !switchPlaylistId || playlistUnchanged}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-500/10 text-blue-400 text-sm font-medium rounded-md hover:bg-blue-500/20 border border-blue-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {switching ? (
                <div className="w-4 h-4 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
              ) : (
                <ArrowRightLeft className="w-4 h-4" />
              )}
              {channel.isPlaylistChannel
                ? playlistUnchanged
                  ? 'Current Playlist'
                  : 'Change Playlist'
                : 'Switch to Playlist'}
            </button>
          </div>

          {/* Switch to Live */}
          <div className="bg-[#0a0a0a] border border-[#333333] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Radio className="w-4 h-4 text-green-400" />
              <h4 className="text-sm font-medium text-white">Live Feed Mode</h4>
              {!channel.isPlaylistChannel && (
                <span className="text-[10px] uppercase tracking-wider text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded">Active</span>
              )}
            </div>
            <input
              type="text"
              value={switchSourceUrl}
              onChange={(e) => setSwitchSourceUrl(e.target.value)}
              placeholder={
                switchSourceType === 'RTMP'
                  ? 'Optional for RTMP (auto: rtmp://nginx-rtmp:1936/live/<channel-slug>)'
                  : 'rtmp://example.com/live/stream'
              }
              className="w-full px-3 py-2 bg-[#111111] border border-[#333333] rounded-md text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 text-sm mb-2"
            />
            {switchSourceType === 'RTMP' && (
              <p className="text-xs text-gray-500 mb-2">
                OBS Server: <code className="text-gray-300">rtmp://YOUR_IP:1936/live</code> and stream key{' '}
                <code className="text-gray-300">/{channel.slug}</code>. URL can be empty here.
              </p>
            )}
            <select
              value={switchSourceType}
              onChange={(e) => setSwitchSourceType(e.target.value)}
              className="w-full px-3 py-2 bg-[#111111] border border-[#333333] rounded-md text-white focus:outline-none focus:border-gray-500 text-sm mb-3"
            >
              {['M3U8', 'MP4', 'RTMP', 'MPEGTS', 'SRT', 'UDP', 'HTTP'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <button
              onClick={() => handleSwitchMode('live')}
              disabled={
                switching ||
                (switchSourceType !== 'RTMP' && !switchSourceUrl.trim()) ||
                liveUnchanged
              }
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-500/10 text-green-400 text-sm font-medium rounded-md hover:bg-green-500/20 border border-green-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {switching ? (
                <div className="w-4 h-4 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
              ) : (
                <ArrowRightLeft className="w-4 h-4" />
              )}
              {!channel.isPlaylistChannel
                ? liveUnchanged
                  ? 'Current Live Source'
                  : 'Update Live Source'
                : 'Switch to Live Feed'}
            </button>
          </div>
        </div>
      </Modal>

      <ViewerMapFullscreen
        isOpen={viewerMapOpen}
        onClose={() => setViewerMapOpen(false)}
        channelId={channel.id}
        channelName={channel.name}
        viewerCount={viewers}
        locations={viewerLocations}
      />
    </Layout>
  );
};

interface DetailRowProps {
  label: string;
  value: React.ReactNode;
  truncate?: boolean;
}

const DetailRow: React.FC<DetailRowProps> = ({ label, value, truncate }) => (
  <div className="flex items-start justify-between gap-2">
    <span className="text-xs text-gray-500 flex-shrink-0">{label}</span>
    <span className={`text-xs text-gray-300 text-right ${truncate ? 'truncate max-w-[180px]' : ''}`}>
      {value}
    </span>
  </div>
);

interface StatRowProps {
  label: string;
  value: string;
}

const StatRow: React.FC<StatRowProps> = ({ label, value }) => (
  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
    <span className="text-xs text-gray-500">{label}</span>
    <span className="text-sm font-mono text-white">{value}</span>
  </div>
);

function formatUptime(seconds?: number): string {
  if (!seconds) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default ChannelDetailPage;
