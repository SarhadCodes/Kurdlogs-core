import { useEffect, useRef, useState } from 'react';
import { Trash2, WifiOff, Cpu, HardDrive, Gauge, Clock, Heart, ListVideo, Radio, Users, Monitor, Globe, Blocks } from 'lucide-react';
import Hls from 'hls.js';
import { Channel, StreamStats, ChannelStatus } from '../types';
import type { ViewerLocation, ViewerMapPayload } from '../types/viewer';
import { wsService } from '../services/websocket';
import { useViewerHeartbeat } from '../hooks/useViewerHeartbeat';
import { setViewerStreamMeta } from '../utils/viewerSession';
import { buildStreamUrl, getPlaylistVariantManifest } from '../utils/streamUrl';
import ViewerMapFullscreen from './ViewerMapFullscreen';

interface ChannelCardProps {
  channel: Channel;
  onClick?: () => void;
  onDelete?: (e: React.MouseEvent) => void;
}

const statusConfig: Record<ChannelStatus, { dot: string; bg: string; label: string }> = {
  ONLINE: { dot: 'bg-green-500', bg: 'bg-green-500/10 text-green-400 border-green-500/20', label: 'Online' },
  OFFLINE: { dot: 'bg-gray-500', bg: 'bg-gray-500/10 text-gray-400 border-gray-500/20', label: 'Offline' },
  ERROR: { dot: 'bg-red-500', bg: 'bg-red-500/10 text-red-400 border-red-500/20', label: 'Error' },
  STARTING: { dot: 'bg-yellow-500', bg: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', label: 'Starting' },
  STOPPING: { dot: 'bg-yellow-500', bg: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', label: 'Stopping' },
};

function getHealth(stats: StreamStats | null, status: ChannelStatus): { label: string; color: string } {
  if (status !== 'ONLINE' || !stats) return { label: 'N/A', color: 'text-gray-500' };
  const speed = parseFloat(stats.speed) || 0;
  if (speed >= 0.95 && stats.fps > 0) return { label: 'Excellent', color: 'text-green-400' };
  if (speed >= 0.8) return { label: 'Good', color: 'text-blue-400' };
  if (speed >= 0.5) return { label: 'Fair', color: 'text-yellow-400' };
  return { label: 'Poor', color: 'text-red-400' };
}

function formatUptime(seconds?: number): string {
  if (!seconds) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBitrate(kbps?: number): string {
  if (!kbps) return '0 kbps';
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}

function formatGpu(gpu?: number): string {
  if (gpu === undefined) return '0%';
  return `${Math.round(gpu)}%`;
}

function getResolution(channel: Channel): string {
  if (channel.transcodingProfile) {
    return channel.transcodingProfile.resolution.replace('RES_', '');
  }
  if (channel.isPlaylistChannel) return '1080P';
  return 'Passthrough';
}

export default function ChannelCard({ channel, onClick, onDelete }: ChannelCardProps) {
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [status, setStatus] = useState<ChannelStatus>(channel.status);
  const [viewers, setViewers] = useState(0);
  const [viewerLocations, setViewerLocations] = useState<ViewerLocation[]>([]);
  const [viewerMapOpen, setViewerMapOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => { setStatus(channel.status); }, [channel.status]);

  useEffect(() => {
    const unsubStats = wsService.subscribe('channel:stats', (data: { channelId: string; stats: StreamStats }) => {
      if (data.channelId === channel.id) setStats(data.stats);
    });
    const unsubStatus = wsService.subscribe('channel:status', (data: { channelId: string; status: ChannelStatus }) => {
      if (data.channelId === channel.id) setStatus(data.status);
    });
    const unsubViewers = wsService.subscribe('viewer:count', (counts: Record<string, number>) => {
      setViewers(counts[channel.id] || 0);
    });
    const unsubMap = wsService.subscribe('viewer:map', (payload: ViewerMapPayload) => {
      setViewerLocations(payload.channels[channel.id] || []);
    });
    return () => {
      unsubStats();
      unsubStatus();
      unsubViewers();
      unsubMap();
    };
  }, [channel.id]);

  useViewerHeartbeat(channel.id, status === 'ONLINE');

  useEffect(() => {
    if (status !== 'ONLINE' || !stats?.bitrate) return;
    setViewerStreamMeta({
      bitrateKbps: Math.round(stats.bitrate / 1000),
      player: 'KurdLogs Core',
    });
  }, [status, stats?.bitrate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || status !== 'ONLINE') {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      return;
    }

    const manifest = channel.isPlaylistChannel
      ? getPlaylistVariantManifest(channel.transcodingProfile?.resolution)
      : 'master.m3u8';
    const src = buildStreamUrl(channel.slug, manifest);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: false,
        lowLatencyMode: !channel.isPlaylistChannel,
        maxBufferLength: channel.isPlaylistChannel ? 16 : 4,
        maxMaxBufferLength: channel.isPlaylistChannel ? 32 : 8,
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal && data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      });
      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.play().catch(() => {});
    }

    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [status, channel.slug]);

  const cfg = statusConfig[status] || statusConfig.OFFLINE;
  const health = getHealth(stats, status);
  const isLive = status === 'ONLINE';

  return (
    <>
    <div
      onClick={onClick}
      className="group cursor-pointer overflow-hidden rounded-xl border border-border bg-card/80 shadow-sm transition-colors hover:border-border/80 hover:bg-card"
    >
      {/* Viewer Bar — stop clicks here so card navigation does not fire */}
      <div
        className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Live Preview</span>
        <button
          type="button"
          disabled={!isLive}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setViewerMapOpen(true);
          }}
          className={`flex items-center gap-1.5 text-[11px] rounded-md px-2 py-1 border transition-colors ${
            isLive
              ? 'text-gray-400 border-[#30363d] hover:text-[#e6edf3] hover:border-[#484f58] hover:bg-[#21262d] cursor-pointer'
              : 'text-gray-600 border-transparent cursor-not-allowed opacity-60'
          }`}
          title={isLive ? 'Open viewer map (globe)' : 'Viewer map available when channel is online'}
        >
          <Globe className="w-3.5 h-3.5 shrink-0" />
          <Users className="w-3 h-3 shrink-0" />
          <span className="font-mono">{isLive ? viewers : 0}</span>
          <span className="text-gray-500 text-[10px]">viewers</span>
        </button>
      </div>

      {/* Live Preview */}
      <div className="relative aspect-video bg-black">
        {isLive ? (
          <>
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              muted
              playsInline
            />
            <div className="absolute top-2 left-2">
              <span className="flex items-center gap-1 px-2 py-0.5 bg-red-600 rounded text-[10px] font-bold text-white uppercase tracking-wider">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                Live
              </span>
            </div>
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center">
            <WifiOff className="w-8 h-8 text-[#333] mb-1.5" />
            <span className="text-[11px] text-[#444]">{status === 'ERROR' ? 'Stream Error' : 'Offline'}</span>
          </div>
        )}
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(e); }}
            className="absolute top-2 right-2 p-1.5 bg-black/60 rounded-md text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Channel Info */}
      <div className="p-3.5">
        {/* Name + Status */}
        <div className="mb-2.5 flex items-center justify-between">
          <h3 className="truncate pr-2 font-display text-sm font-semibold text-foreground">{channel.name}</h3>
          <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cfg.bg}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot} ${status === 'ONLINE' ? 'animate-pulse' : ''}`} />
            {cfg.label}
          </span>
        </div>

        {/* Tags */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {channel.useBlueprint ? (
              <>
                <Blocks className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Blueprint</span>
              </>
            ) : channel.isPlaylistChannel ? (
              <>
                <ListVideo className="h-3 w-3" />
                Playlist
              </>
            ) : (
              <>
                <Radio className="h-3 w-3" />
                Live
              </>
            )}
          </span>
          <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {channel.outputType}
          </span>
          <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {getResolution(channel)}
          </span>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          <StatItem icon={<Cpu className="w-3 h-3" />} label="CPU" value={isLive ? `${stats?.cpu?.toFixed(0) || 0}%` : '--'} />
          <StatItem icon={<HardDrive className="w-3 h-3" />} label="RAM" value={isLive ? `${stats?.ram || 0} MB` : '--'} />
          <StatItem icon={<Monitor className="w-3 h-3" />} label="GPU" value={isLive ? formatGpu(stats?.gpu) : '--'} />
          <StatItem icon={<Gauge className="w-3 h-3" />} label="Bitrate" value={isLive ? formatBitrate(stats?.bitrate) : '--'} />
          <StatItem icon={<Clock className="w-3 h-3" />} label="Uptime" value={isLive ? formatUptime(stats?.uptime) : '--'} />
          <StatItem
            icon={<Heart className="w-3 h-3" />}
            label="Health"
            value={isLive ? health.label : '--'}
            valueColor={isLive ? health.color : undefined}
          />
        </div>
      </div>
    </div>

    <ViewerMapFullscreen
      isOpen={viewerMapOpen}
      onClose={() => setViewerMapOpen(false)}
      channelId={channel.id}
      channelName={channel.name}
      viewerCount={viewers}
      locations={viewerLocations}
    />
    </>
  );
}

function StatItem({ icon, label, value, valueColor, colSpan }: {
  icon: React.ReactNode; label: string; value: string; valueColor?: string; colSpan?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${colSpan ? 'col-span-2 mt-1 border-t border-border pt-1' : ''}`}>
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className={`font-mono text-[11px] ${valueColor || 'text-foreground/80'}`}>{value}</span>
    </div>
  );
}
