/** Channel Blueprint v13 — core types and future extension points. */

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

export type BlueprintSelectionMode = 'RANDOM' | 'SEQUENTIAL';

/** SUPER block: play N videos or the full playlist before advancing. */
export type SuperPlayMode = 'COUNT' | 'ALL';

export type TransitionMode = 'ALWAYS' | 'EVERY_N_ITEMS' | 'EVERY_N_MINUTES';

export interface BlockTransitionIn {
  mode: TransitionMode;
  /** N items or minutes when mode is EVERY_N_* */
  value?: number;
  /** Count plays of this block type before entering (default: previous block type) */
  afterBlockType?: BlueprintBlockType;
}

export interface BlueprintBlockConfig {
  playlistId?: string;
  selectionMode?: BlueprintSelectionMode;
  /** Videos to play per block visit (SUPER default 5, others default 1). */
  repeatCount?: number;
  /** SUPER only: play repeatCount videos or entire playlist per visit. */
  superPlayMode?: SuperPlayMode;
  /** Transition gate before this block plays (click arrow in UI) */
  transitionIn?: BlockTransitionIn;
  /** Future: prime-time, weekly schedule, time-of-day */
  scheduleRules?: Record<string, unknown>;
  /** Future: prime-time blocks */
  primeTimeRules?: Record<string, unknown>;
  /** Future: blueprint versioning metadata */
  versionMeta?: Record<string, unknown>;
}

export interface BlueprintBlock {
  id: string;
  type: BlueprintBlockType;
  label?: string;
  config: BlueprintBlockConfig;
}

export interface ResolvedSegment {
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
  /** Nth play of this blockId+itemId since schedule anchor (0-based). */
  occurrenceIndex: number;
}

export type SimulationWarningCode =
  | 'EMPTY_PLAYLIST'
  | 'MISSING_PLAYLIST'
  | 'REPETITION'
  | 'EMPTY_BLOCK'
  | 'NO_LOOP'
  | 'SINGLE_ITEM'
  | 'HIGH_REPEAT'
  | 'PROMO_TOO_SMALL'
  | 'STATION_ID_MISSING'
  | 'LOW_COVERAGE';

export interface SimulationWarning {
  code: SimulationWarningCode;
  message: string;
  suggestion?: string;
  blockId?: string;
  severity?: 'info' | 'warning' | 'critical';
}

export interface CoverageBreakdown {
  label: string;
  blockType: BlueprintBlockType;
  durationSec: number;
  formatted: string;
}

export interface DiversityScore {
  score: number;
  label: string;
  reasons: string[];
}

export interface SimulationResult {
  horizon: '1h' | '24h' | '7d';
  startedAt: string;
  endedAt: string;
  segments: ResolvedSegment[];
  warnings: SimulationWarning[];
  stats: {
    totalSegments: number;
    totalDurationSec: number;
    uniqueTitles: number;
    cycleCount: number;
  };
  diversity?: DiversityScore;
  coverage?: {
    totalDurationSec: number;
    formatted: string;
    breakdown: CoverageBreakdown[];
  };
  /** Index of segment playing at generation time (live channel sync) */
  liveSegmentIndex?: number | null;
  syncedWithChannel?: boolean;
  scheduleAnchor?: string;
  engineState?: BlueprintRuntimeState;
  generatedAt?: string;
  blueprintUpdatedAt?: string;
  /** Invalidates client/server timeline cache on window roll */
  playbackEpoch?: number;
}

export interface BlueprintLiveCursor {
  channelId: string;
  blueprintId: string;
  now: string;
  /** Current segment from FFmpeg activePlaybackTimeSec */
  current: {
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
  /** @deprecated same as current */
  engine: BlueprintLiveCursor['current'];
  /** @deprecated same as current */
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
  /** How timelineIndex was resolved — segment_identity | none */
  timelineMatchMethod?: string | null;
  scheduleAnchorMs: number | null;
  cursorSource?: 'ffmpeg_live' | 'runtime_cache' | 'fallback_zero';
  activePlaybackTimeSec?: number;
  /** @deprecated use activePlaybackTimeSec */
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

export interface BlueprintRuntimeState {
  blockIndex: number;
  cycleCount: number;
  /** Playlist-scoped for SEQUENTIAL; per-block for RANDOM */
  sequentialCursors: Record<string, number>;
  lastItemByBlock: Record<string, string>;
  /** Plays per block type since last reset (for transitions) */
  typePlayCounts: Record<string, number>;
  minutesSinceReset: number;
  /** Persisted across batches/windows so RNG never resets mid-schedule */
  rngCounter?: number;
  /** Global play count per blockId+itemId for timeline segment identity */
  occurrenceCounters?: Record<string, number>;
}

export interface PlaylistInsight {
  id: string;
  name: string;
  itemCount: number;
  durationSec: number;
  formattedDuration: string;
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
  playlistInsights: PlaylistInsight[];
}

/** Future: live block refresh without restart */
export interface BlueprintPlaybackAdapter {
  refreshRollingWindow(channelId: string): Promise<void>;
}

/** Future: weekly scheduling engine */
export interface BlueprintScheduleEngine {
  resolveActiveBlocks(at: Date): Promise<BlueprintBlock[]>;
}

/** Future: coming-up-next metadata */
export interface BlueprintEpgAdapter {
  getUpNext(channelId: string, limit: number): Promise<ResolvedSegment[]>;
}

export interface BlueprintVersioning {
  version: number;
  publishedAt?: string;
  changelog?: string;
}
