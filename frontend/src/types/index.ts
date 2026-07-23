export interface User {
  id: string;
  username: string;
  role: 'ADMIN' | 'SUPERVISOR' | 'OPERATOR' | 'VIEWER';
  displayName?: string | null;
  avatarUrl?: string | null;
  mustChangePassword?: boolean;
}

export type SourceType = 'M3U8' | 'MP4' | 'RTMP' | 'MPEGTS' | 'SRT' | 'UDP' | 'HTTP';
export type OutputType = 'HLS' | 'DASH';
export type ChannelStatus = 'OFFLINE' | 'ONLINE' | 'ERROR' | 'STARTING' | 'STOPPING';
export type OverlayType = 'LOGO' | 'SCROLLING_TEXT' | 'LIVE_BADGE' | 'WATERMARK' | 'CLOCK';
export type Resolution = 'RES_1080P' | 'RES_720P' | 'RES_480P';

export interface Channel {
  id: string;
  name: string;
  slug: string;
  sourceUrl: string;
  sourceType: SourceType;
  status: ChannelStatus;
  transcodingProfileId?: string;
  autoReconnect: boolean;
  maxReconnectAttempts: number;
  reconnectDelay: number;
  customFfmpegArgs?: string;
  pid?: number;
  outputType: OutputType;
  enableDvr: boolean;
  dvrWindowMinutes: number;
  isPlaylistChannel: boolean;
  playlistId?: string;
  useBlueprint?: boolean;
  blueprintId?: string | null;
  blueprint?: { id: string; name: string; status?: string } | null;
  playlist?: { id: string; name: string } | null;
  createdAt: string;
  transcodingProfile?: TranscodingProfile;
  overlays?: Overlay[];
}

export interface TranscodingProfile {
  id: string;
  name: string;
  resolution: Resolution;
  videoBitrate: string;
  audioBitrate: string;
  fps: number;
  videoCodec: string;
  audioCodec: string;
  preset: string;
  isDefault: boolean;
}

export interface Token {
  id: string;
  channelId: string;
  token: string;
  expiresAt: string;
  refreshIntervalMinutes: number;
  isActive: boolean;
  channel?: Channel;
}

export interface Playlist {
  id: string;
  name: string;
  isLooping: boolean;
  brandProfileId?: string | null;
  brandProfile?: { id: string; name: string } | null;
  _count?: { items: number };
  items?: PlaylistItem[];
}

export type PlaylistItemStatus = 'PROCESSING' | 'READY' | 'FAILED';

export interface PlaylistItemLogoConfig {
  enabled?: boolean;
  path?: string;
  imagePath?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
}

export interface PlaylistItem {
  id: string;
  playlistId: string;
  videoPath: string;
  sourceVideoPath?: string | null;
  originalFilename: string;
  position: number;
  duration?: number;
  logoConfig?: PlaylistItemLogoConfig | null;
  logoBurned?: boolean;
  processingError?: string | null;
  status: PlaylistItemStatus;
}

export interface Overlay {
  id: string;
  channelId: string;
  type: OverlayType;
  config: Record<string, any>;
  isActive: boolean;
  position: string;
}

export interface StreamStats {
  cpu: number;
  ram: number;
  gpu: number;
  bitrate: number;
  fps: number;
  uptime: number;
  speed: string;
  frames: number;
}

export interface SystemStats {
  cpu: number;
  ram: number;
  totalMem: number;
  usedMem: number;
  activeChannels: number;
  uptime: number;
}

export interface StreamLog {
  id: string;
  channelId: string;
  level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
  message: string;
  timestamp: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export type BoostNodeStatus = 'PENDING' | 'ONLINE' | 'OFFLINE' | 'ERROR';

export interface BoostNode {
  id: string;
  name: string;
  host: string;
  port: number;
  encode: boolean;
  stream: boolean;
  maxChannels: number;
  status: BoostNodeStatus;
  secretKey: string;
  notes?: string | null;
  lastSeenAt?: string | null;
  workerHostname?: string | null;
  workerVersion?: string | null;
  workerCpu?: number | null;
  workerRam?: number | null;
  activeChannels?: number;
  createdAt: string;
  updatedAt: string;
}

export interface BoostSummary {
  total: number;
  online: number;
  pending: number;
  offline: number;
  error: number;
  encodeCapacity: number;
  streamCapacity: number;
}

export interface BrandProfile {
  id: string;
  name: string;
  logoPath?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  enabled: boolean;
  watermarkPath?: string | null;
  bugPath?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProcessingJobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type ProcessingJobType = 'INGEST' | 'REBRAND' | 'RETRY';

export interface ProcessingJob {
  id: string;
  playlistItemId?: string | null;
  type: ProcessingJobType;
  status: ProcessingJobStatus;
  progressPct: number;
  currentFrame?: number | null;
  currentTimeSec?: number | null;
  encodingSpeed?: string | null;
  etaSeconds?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorMessage?: string | null;
  mode?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  playlistItem?: { id: string; originalFilename: string; playlistId: string };
}

export type HealthLevel = 'EXCELLENT' | 'GOOD' | 'WARNING' | 'CRITICAL';

export interface ChannelHealthReport {
  channelId: string;
  slug: string;
  name: string;
  status: string;
  health: HealthLevel;
  healthScore: number;
  cpu: number;
  ram: number;
  bitrate: number;
  fps: number;
  speed: string;
  pid: number | null;
  viewers: number;
  segmentsActive: boolean;
  uptime: number;
  playback?: {
    playbackSource: 'BLUEPRINT' | 'PLAYLIST';
    blueprintName?: string | null;
    currentBlock?: string | null;
    currentPlaylist?: string | null;
    currentAsset?: string | null;
    nextBlock?: string | null;
    nextAsset?: string | null;
  };
}

export interface BenchmarkReport {
  id: string;
  targetChannels: number;
  startedAt: string;
  finishedAt: string;
  durationSec: number;
  samples: Array<{
    at: string;
    systemCpu: number;
    systemRamPct: number;
    activeChannels: number;
    totalFfmpegCpu: number;
    totalFfmpegRamMb: number;
  }>;
  summary: {
    avgSystemCpu: number;
    peakSystemCpu: number;
    avgFfmpegCpu: number;
    peakFfmpegCpu: number;
    avgRamPct: number;
    peakRamPct: number;
    diskWriteEstimateKbPerSec: number;
  };
  recommendation: string;
}

export type SimulationHorizon = '1h' | '24h' | '7d';

export type BlueprintBlockType =
  | 'MOVIE'
  | 'PROMO'
  | 'INTRO'
  | 'STATION_ID'
  | 'MUSIC'
  | 'CARTOON'
  | 'SCHEDULE'
  | 'SUPER'
  | 'LOOP';

export type SuperPlayMode = 'COUNT' | 'ALL';

export interface BlueprintBlock {
  id: string;
  type: BlueprintBlockType;
  label?: string;
  config: {
    playlistId?: string;
    selectionMode?: 'RANDOM' | 'SEQUENTIAL';
    repeatCount?: number;
    superPlayMode?: SuperPlayMode;
    transitionIn?: {
      mode: 'ALWAYS' | 'EVERY_N_ITEMS' | 'EVERY_N_MINUTES';
      value?: number;
      afterBlockType?: BlueprintBlockType;
    };
  };
}

export interface BlueprintSummary {
  blockCounts: {
    movies: number;
    promos: number;
    stationIds: number;
    intros: number;
    music: number;
    cartoons: number;
    supers: number;
  };
  estimatedLoopDurationSec: number;
  estimatedLoopFormatted: string;
  uniqueAssets: number;
  repeatRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  repeatRiskLabel: string;
  blueprintScore: number;
  coverageHours: number;
  coverageFormatted: string;
  playlistInsights: Array<{
    id: string;
    name: string;
    itemCount: number;
    durationSec: number;
    formattedDuration: string;
  }>;
}

export interface PublishBlueprintResult {
  channel: { id: string; name: string; status: string };
  playbackMode: 'BLUEPRINT';
  blueprintName: string;
  status: 'Active' | 'Pending restart';
  streamRestarted: boolean;
  segmentCount: number;
  warnings: string[];
  blueprint?: ChannelBlueprint;
}

export interface ChannelBlueprint {
  id: string;
  name: string;
  description?: string | null;
  status: 'DRAFT' | 'PUBLISHED';
  templateKey?: string | null;
  blocks: BlueprintBlock[];
  channel?: { id: string; name: string; slug: string; status: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface BlueprintSimulation {
  horizon: SimulationHorizon;
  startedAt: string;
  endedAt: string;
  segments: Array<{
    blockId: string;
    blockType: BlueprintBlockType;
    blockLabel: string;
    playlistId: string | null;
    playlistName: string;
    itemId: string | null;
    title: string;
    durationSec: number;
    startsAt: string;
    endsAt: string;
    occurrenceIndex: number;
  }>;
  warnings: Array<{
    code: string;
    message: string;
    suggestion?: string;
    blockId?: string;
    severity?: 'info' | 'warning' | 'critical';
  }>;
  stats: {
    totalSegments: number;
    totalDurationSec: number;
    uniqueTitles: number;
    cycleCount: number;
  };
  diversity?: {
    score: number;
    label: string;
    reasons: string[];
  };
  coverage?: {
    totalDurationSec: number;
    formatted: string;
    breakdown: Array<{
      label: string;
      blockType: BlueprintBlockType;
      durationSec: number;
      formatted: string;
    }>;
  };
  /** Segment index playing at generation time (when synced to a live channel) */
  liveSegmentIndex?: number | null;
  syncedWithChannel?: boolean;
  scheduleAnchor?: string;
  generatedAt?: string;
  blueprintUpdatedAt?: string;
  playbackEpoch?: number;
}

export interface BlueprintLiveCursor {
  channelId: string;
  blueprintId: string;
  now: string;
  current?: {
    windowIndex: number;
    blockId: string;
    blockLabel: string;
    blockType: string;
    title: string;
    itemId: string | null;
    occurrenceIndex: number;
    startsAt: string;
    endsAt: string;
  } | null;
  engine: BlueprintLiveCursor['current'];
  visible: BlueprintLiveCursor['current'];
  timing: {
    activePlaybackTimeSec: number;
    currentIndex: number;
    segmentOffsetSec: number;
    playbackSource: 'FFmpeg';
    timeSource?: 'ffmpeg_live' | 'runtime_cache' | 'fallback_zero';
  } | null;
  timelineIndex: number | null;
  timelineSegment: {
    blockLabel: string;
    title: string;
    startsAt: string;
    endsAt: string;
  } | null;
  timelineMatchMethod?: string | null;
  scheduleAnchorMs: number | null;
  cursorSource?: 'ffmpeg_live' | 'runtime_cache' | 'fallback_zero';
  activePlaybackTimeSec?: number;
  activeFfmpegTimeSec?: number;
  playbackEpoch?: number;
  inSync: boolean;
  mismatch: string | null;
}

export interface PipelineForensicsSnapshot {
  channelId: string;
  blueprintId: string;
  timestamp: string;
  blueprintMedia: string | null;
  engineMedia: string | null;
  ffmpegMedia: string | null;
  hlsMedia: string | null;
  liveCursorMedia: string | null;
  timelineMedia: string | null;
  nowPlayingMedia: string | null;
  previewMedia: string | null;
  blueprintIndex: number | null;
  engineIndex: number | null;
  hlsIndex: number | null;
  timelineIndex: number | null;
  ffmpegTimeSec: number | null;
  ffmpegLiveTimeSec: number | null;
  rawFfmpegTimeSec: number | null;
  windowMediaSec: number | null;
  visibleTimeSec: number | null;
  totalLagSec: number;
  ffmpegStaleSec: number | null;
  timelineSource: 'request' | 'cache' | 'none';
}

export interface AppLogEntry {
  id: string;
  category: string;
  message: string;
  level: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}
