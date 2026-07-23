export type McrSourceType =
  | 'BLUEPRINT'
  | 'PLAYLIST'
  | 'RTMP'
  | 'RTMP_INGEST'
  | 'SRT'
  | 'RTSP'
  | 'HLS'
  | 'MPEGTS'
  | 'UDP'
  | 'NDI'
  | 'EMERGENCY';

export type McrRoutingMode = 'AUTOMATION' | 'MANUAL';
export type McrSourceHealthStatus = 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'UNKNOWN';

export interface McrSourceHealth {
  sourceId: string;
  label: string;
  sourceType: McrSourceType;
  status: McrSourceHealthStatus;
  bitrate: number;
  fps: number;
  resolution: string | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  audioCodec: string | null;
  lastUpdate: string;
  refChannelId?: string | null;
  inputUrl?: string | null;
  streamKey?: string | null;
}

export interface McrSourceView {
  id: string;
  label: string;
  sourceType: McrSourceType;
  refChannelId: string | null;
  inputUrl: string | null;
  streamKey: string | null;
  isAutoDiscover: boolean;
  enabled: boolean;
  sortOrder: number;
  health: McrSourceHealth;
  sessionActive?: boolean;
  sessionUptimeSec?: number;
  sessionStatus?: 'CONNECTING' | 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  sessionMetrics?: {
    fps: number;
    bitrate: number;
    resolution: string | null;
    audioPresent: boolean;
    lastFrameAt: number | null;
    frozen: boolean;
  };
  previewUrl?: string | null;
}

export interface McrRouterSnapshot {
  channelId: string;
  channelName: string;
  channelSlug: string;
  channelStatus: string;
  enabled: boolean;
  routingMode: McrRoutingMode;
  programSourceId: string | null;
  previewSourceId: string | null;
  automationSourceId: string | null;
  programSource: McrSourceView | null;
  previewSource: McrSourceView | null;
  automationSource: McrSourceView | null;
  sources: McrSourceView[];
  busRtmpUrl: string;
  relayRunning: boolean;
  relayUptimeSec: number;
  programStats: {
    bitrate: number;
    fps: number;
    uptime: number;
    resolution?: string;
  } | null;
  previewUrls?: Record<string, string | null>;
  outputHealth?: {
    encoderOnline: boolean;
    lastSegmentAt: number | null;
    fps: number;
    bitrate: number;
  };
  switcherRunning?: boolean;
  architectureVersion?: string;
}

export interface McrChannelRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  mcrRouter?: { enabled: boolean; routingMode: McrRoutingMode } | null;
}

export interface McrAvailableChannel {
  id: string;
  name: string;
  slug: string;
  status: string;
  useBlueprint: boolean;
  isPlaylistChannel: boolean;
  blueprint?: { name: string } | null;
  playlist?: { name: string } | null;
}

export interface McrIngestPublisher {
  streamKey: string;
  label: string | null;
  clientIp: string | null;
  active: boolean;
  bitrate: number;
  fps: number;
  width: number | null;
  height: number | null;
  hasAudio: boolean | null;
  rtmpUrl: string;
  publishUrl: string;
  startedAt: string;
  lastSeenAt: string;
}

export interface AddMcrSourcePayload {
  label: string;
  sourceType: McrSourceType;
  inputUrl?: string;
  refChannelId?: string;
  streamKey?: string;
}

export type McrDropZone = 'preview' | 'program' | 'aux1' | 'aux2' | 'aux3' | 'aux4';
