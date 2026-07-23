import { logger } from '../utils/logger';
import type {
  BlueprintBlock,
  BlueprintBlockType,
  BlueprintRuntimeState,
  ResolvedSegment,
  SimulationResult,
  SimulationWarning,
} from '../types/blueprint.types';

export type ExecutionSource = 'ENGINE' | 'TIMELINE' | 'VERIFY';

export interface PlaylistContentItem {
  id: string;
  originalFilename: string;
  durationSec: number;
  videoPath: string;
}

export interface PlaylistContentSource {
  id: string;
  name: string;
  items: PlaylistContentItem[];
}

const DEFAULT_ITEM_DURATION = 120;
const HORIZON_MS: Record<SimulationResult['horizon'], number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const CONTENT_TYPES = new Set<BlueprintBlockType>([
  'MOVIE',
  'PROMO',
  'INTRO',
  'STATION_ID',
  'MUSIC',
  'CARTOON',
  'SCHEDULE',
  'SUPER',
]);

function blockLabel(block: BlueprintBlock): string {
  return block.label || block.type.replace(/_/g, ' ');
}

function createInitialState(): BlueprintRuntimeState {
  return {
    blockIndex: 0,
    cycleCount: 0,
    sequentialCursors: {},
    lastItemByBlock: {},
    typePlayCounts: {},
    minutesSinceReset: 0,
    occurrenceCounters: {},
  };
}

function segmentOccurrenceKey(blockId: string, itemId: string): string {
  return `${blockId}:${itemId}`;
}

function nextOccurrenceIndex(
  state: BlueprintRuntimeState,
  blockId: string,
  itemId: string
): number {
  if (!state.occurrenceCounters) state.occurrenceCounters = {};
  const key = segmentOccurrenceKey(blockId, itemId);
  const occurrenceIndex = state.occurrenceCounters[key] ?? 0;
  state.occurrenceCounters[key] = occurrenceIndex + 1;
  return occurrenceIndex;
}

/** SEQUENTIAL advances per playlist (not per card) so duplicate blocks share one cursor. */
export function sequentialCursorKey(block: BlueprintBlock): string {
  const playlistId = block.config.playlistId;
  const mode = block.config.selectionMode || 'SEQUENTIAL';
  if (mode === 'SEQUENTIAL' && playlistId) {
    return `playlist:${playlistId}`;
  }
  return `block:${block.id}`;
}

export function formatCursorState(
  state: BlueprintRuntimeState,
  blocks: BlueprintBlock[]
): string {
  const parts: string[] = [`blockIndex=${state.blockIndex}`];
  const seen = new Set<string>();
  for (const block of blocks) {
    const key = sequentialCursorKey(block);
    if (seen.has(key)) continue;
    seen.add(key);
    const idx = state.sequentialCursors[key] ?? 0;
    const label = block.config.playlistId
      ? `${block.type.toLowerCase()}[${block.config.playlistId.slice(0, 8)}]=${idx}`
      : `${block.type.toLowerCase()}=${idx}`;
    parts.push(label);
  }
  if (state.rngCounter != null) parts.push(`rng=${state.rngCounter}`);
  return parts.join(' ');
}

function cloneState(state: BlueprintRuntimeState): BlueprintRuntimeState {
  return {
    ...state,
    sequentialCursors: { ...state.sequentialCursors },
    lastItemByBlock: { ...state.lastItemByBlock },
    typePlayCounts: { ...state.typePlayCounts },
    occurrenceCounters: { ...(state.occurrenceCounters ?? {}) },
  };
}

function pickItem(
  block: BlueprintBlock,
  playlist: PlaylistContentSource | undefined,
  state: BlueprintRuntimeState,
  rng: () => number
): PlaylistContentItem | null {
  if (!playlist || playlist.items.length === 0) return null;

  const mode = block.config.selectionMode || 'SEQUENTIAL';
  if (mode === 'RANDOM') {
    const idx = Math.floor(rng() * playlist.items.length);
    return playlist.items[idx];
  }

  const cursorKey = sequentialCursorKey(block);
  const cursor = state.sequentialCursors[cursorKey] ?? 0;
  const item = playlist.items[cursor % playlist.items.length];
  state.sequentialCursors[cursorKey] = cursor + 1;
  return item;
}

function shuffleItems<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** SUPER block: play multiple videos (or full playlist) before the next block. */
function itemsForBlockVisit(
  block: BlueprintBlock,
  playlist: PlaylistContentSource,
  state: BlueprintRuntimeState,
  rng: () => number
): PlaylistContentItem[] {
  if (block.type === 'SUPER' && (block.config.superPlayMode || 'COUNT') === 'ALL') {
    if (playlist.items.length === 0) return [];
    if ((block.config.selectionMode || 'SEQUENTIAL') === 'RANDOM') {
      return shuffleItems(playlist.items, rng);
    }
    const cursorKey = sequentialCursorKey(block);
    const start = state.sequentialCursors[cursorKey] ?? 0;
    const ordered: PlaylistContentItem[] = [];
    for (let i = 0; i < playlist.items.length; i++) {
      ordered.push(playlist.items[(start + i) % playlist.items.length]);
    }
    state.sequentialCursors[cursorKey] = start + playlist.items.length;
    return ordered;
  }

  const repeatCount =
    block.type === 'SUPER'
      ? Math.max(1, block.config.repeatCount ?? 5)
      : Math.max(1, block.config.repeatCount ?? 1);

  const picked: PlaylistContentItem[] = [];
  for (let r = 0; r < repeatCount; r++) {
    const item = pickItem(block, playlist, state, rng);
    if (!item) break;
    picked.push(item);
  }
  return picked;
}

function pushResolvedSegment(
  segments: ResolvedSegment[],
  block: BlueprintBlock,
  playlist: PlaylistContentSource,
  item: PlaylistContentItem,
  state: BlueprintRuntimeState,
  timeCursor: number,
  verbose: boolean,
  source: ExecutionSource,
  blocks: BlueprintBlock[],
  lastPlayedBlock: BlueprintBlock | null
): { timeCursor: number; lastPlayedBlock: BlueprintBlock | null } {
  const cursorBefore = formatCursorState(state, blocks);
  const durationSec =
    Number.isFinite(item.durationSec) && item.durationSec > 0
      ? item.durationSec
      : DEFAULT_ITEM_DURATION;
  const startsAt = new Date(timeCursor);
  timeCursor += durationSec * 1000;
  const endsAt = new Date(timeCursor);
  const startsAtIso = startsAt.toISOString();

  if (verbose && (!lastPlayedBlock || lastPlayedBlock.id !== block.id)) {
    logTransition(lastPlayedBlock, block, item.originalFilename, startsAtIso);
  }
  lastPlayedBlock = block;

  const cursorAfter = formatCursorState(state, blocks);
  if (verbose) {
    logSegmentPick(source, block, item, cursorBefore, cursorAfter, durationSec, startsAtIso);
  }

  segments.push({
    blockId: block.id,
    blockType: block.type,
    blockLabel: blockLabel(block),
    playlistId: playlist.id,
    playlistName: playlist.name,
    itemId: item.id,
    title: item.originalFilename,
    durationSec,
    startsAt: startsAtIso,
    endsAt: endsAt.toISOString(),
    occurrenceIndex: nextOccurrenceIndex(state, block.id, item.id),
  });

  state.lastItemByBlock[block.id] = item.id;
  state.typePlayCounts[block.type] = (state.typePlayCounts[block.type] ?? 0) + 1;
  state.minutesSinceReset += durationSec / 60;

  return { timeCursor, lastPlayedBlock };
}

function previousContentBlock(blocks: BlueprintBlock[], index: number): BlueprintBlock | null {
  for (let i = index - 1; i >= 0; i--) {
    if (blocks[i].type !== 'LOOP' && CONTENT_TYPES.has(blocks[i].type)) return blocks[i];
  }
  return null;
}

function shouldSkipForTransition(
  block: BlueprintBlock,
  blockIndex: number,
  blocks: BlueprintBlock[],
  state: BlueprintRuntimeState
): boolean {
  const t = block.config.transitionIn;
  if (!t || t.mode === 'ALWAYS') return false;

  const afterType = t.afterBlockType || previousContentBlock(blocks, blockIndex)?.type;
  if (!afterType) return false;

  if (t.mode === 'EVERY_N_ITEMS') {
    const need = Math.max(1, t.value ?? 1);
    const count = state.typePlayCounts[afterType] ?? 0;
    return count < need;
  }

  if (t.mode === 'EVERY_N_MINUTES') {
    const needMin = Math.max(1, t.value ?? 1);
    return state.minutesSinceReset < needMin;
  }

  return false;
}

function warn(
  code: SimulationWarning['code'],
  message: string,
  suggestion: string,
  blockId?: string,
  severity: SimulationWarning['severity'] = 'warning'
): SimulationWarning {
  return { code, message, suggestion, blockId, severity };
}

function logSegmentPick(
  source: ExecutionSource,
  block: BlueprintBlock,
  item: PlaylistContentItem,
  cursorBefore: string,
  cursorAfter: string,
  durationSec: number,
  startsAt: string
): void {
  logger.info(
    `[${source}] blockType=${block.type} selectedMedia=${item.originalFilename} ` +
      `cursorBefore={${cursorBefore}} cursorAfter={${cursorAfter}} ` +
      `duration=${durationSec} timestamp=${startsAt}`
  );
}

function logTransition(
  fromBlock: BlueprintBlock | null,
  toBlock: BlueprintBlock,
  selectedMedia: string,
  timestamp: string
): void {
  logger.info(
    `[TRANSITION] fromBlock=${fromBlock ? blockLabel(fromBlock) : 'start'} ` +
      `toBlock=${blockLabel(toBlock)} selectedMedia=${selectedMedia} timestamp=${timestamp}`
  );
}

export interface ResolveSegmentsOptions {
  blocks: BlueprintBlock[];
  playlists: Map<string, PlaylistContentSource>;
  count: number;
  startTime?: Date;
  initialState?: BlueprintRuntimeState;
  seed?: number;
  source?: ExecutionSource;
}

export interface ResolveSegmentsResult {
  segments: ResolvedSegment[];
  state: BlueprintRuntimeState;
  warnings: SimulationWarning[];
}

class BlueprintEngineService {
  analyzeBlueprint(blocks: BlueprintBlock[], playlists: Map<string, PlaylistContentSource>): SimulationWarning[] {
    const warnings: SimulationWarning[] = [];

    if (!blocks.some((b) => b.type === 'LOOP')) {
      warnings.push(
        warn('NO_LOOP', 'No Loop block found', 'Add a Loop block at the end so your channel repeats automatically.', undefined, 'critical')
      );
    }

    const hasStationId = blocks.some((b) => b.type === 'STATION_ID' && b.config.playlistId);
    if (!hasStationId) {
      warnings.push(
        warn(
          'STATION_ID_MISSING',
          'No Station ID configured',
          'Add a Station ID block with a short bumper playlist for professional channel branding.',
          undefined,
          'info'
        )
      );
    }

    let maxMoviePool = 0;
    let maxPromoPool = 0;

    for (const block of blocks) {
      if (block.type === 'LOOP') continue;
      if (!CONTENT_TYPES.has(block.type)) continue;

      const label = blockLabel(block);
      const playlistId = block.config.playlistId;

      if (!playlistId) {
        warnings.push(
          warn('MISSING_PLAYLIST', `${label} has no playlist`, 'Open block settings and choose a content playlist.', block.id, 'critical')
        );
        continue;
      }

      const pl = playlists.get(playlistId);
      if (!pl || pl.items.length === 0) {
        warnings.push(
          warn(
            'EMPTY_PLAYLIST',
            `${label} — playlist "${pl?.name || 'unknown'}" is empty`,
            'Upload videos to this playlist or pick a different one.',
            block.id,
            'critical'
          )
        );
        continue;
      }

      if (pl.items.length === 1) {
        warnings.push(
          warn(
            'SINGLE_ITEM',
            `Only 1 video in "${pl.name}" for ${label}`,
            'Add more videos to reduce repeats — aim for at least 5 items for random blocks.',
            block.id,
            'warning'
          )
        );
      }

      if (block.type === 'MOVIE') maxMoviePool = Math.max(maxMoviePool, pl.items.length);
      if (block.type === 'PROMO') maxPromoPool = Math.max(maxPromoPool, pl.items.length);

      if (block.type === 'MOVIE' && block.config.selectionMode === 'RANDOM' && pl.items.length < 5) {
        warnings.push(
          warn(
            'HIGH_REPEAT',
            `Small movie pool (${pl.items.length} items) with random selection`,
            'Upload more movies or switch to Sequential until your library grows.',
            block.id,
            'warning'
          )
        );
      }
    }

    if (maxMoviePool > 0 && maxPromoPool > 0 && maxPromoPool < maxMoviePool / 4) {
      warnings.push(
        warn(
          'PROMO_TOO_SMALL',
          'Promo playlist is much smaller than movie playlist',
          'Add more promos or reduce promo frequency so viewers don\'t see the same promo too often.',
          undefined,
          'info'
        )
      );
    }

    return this.dedupeWarnings(warnings);
  }

  /** Single source of truth for media selection — used by live engine and timeline. */
  resolveSegments(options: ResolveSegmentsOptions): ResolveSegmentsResult {
    const {
      blocks,
      playlists,
      count,
      startTime = new Date(),
      initialState,
      seed = Date.now(),
      source = 'ENGINE',
    } = options;

    const state = initialState ? cloneState(initialState) : createInitialState();
    const segments: ResolvedSegment[] = [];
    const warnings: SimulationWarning[] = this.analyzeBlueprint(blocks, playlists);
    const verbose =
      source === 'ENGINE' ||
      process.env.BLUEPRINT_EXEC_DEBUG === '1' ||
      (source === 'TIMELINE' && count <= 96);

    let rngCounter = state.rngCounter ?? seed;
    const rng = () => {
      rngCounter = (rngCounter * 1103515245 + 12345) & 0x7fffffff;
      return rngCounter / 0x7fffffff;
    };

    if (blocks.length === 0) {
      state.rngCounter = rngCounter;
      return { segments, state, warnings };
    }

    let timeCursor = startTime.getTime();
    let safety = 0;
    const maxSteps = count * blocks.length * 6 + 80;
    let lastPlayedBlock: BlueprintBlock | null = null;

    while (segments.length < count && safety++ < maxSteps) {
      const block = blocks[state.blockIndex];
      if (!block) {
        state.blockIndex = 0;
        continue;
      }

      if (block.type === 'LOOP') {
        state.blockIndex = 0;
        state.cycleCount += 1;
        state.typePlayCounts = {};
        state.minutesSinceReset = 0;
        continue;
      }

      if (!CONTENT_TYPES.has(block.type)) {
        state.blockIndex = (state.blockIndex + 1) % blocks.length;
        continue;
      }

      if (shouldSkipForTransition(block, state.blockIndex, blocks, state)) {
        state.blockIndex = (state.blockIndex + 1) % blocks.length;
        continue;
      }

      const playlistId = block.config.playlistId;
      const playlist = playlistId ? playlists.get(playlistId) : undefined;

      if (!playlistId || !playlist || playlist.items.length === 0) {
        state.blockIndex = (state.blockIndex + 1) % blocks.length;
        continue;
      }

      const visitItems = itemsForBlockVisit(block, playlist, state, rng);
      for (const item of visitItems) {
        if (segments.length >= count) break;
        const pushed = pushResolvedSegment(
          segments,
          block,
          playlist,
          item,
          state,
          timeCursor,
          verbose,
          source,
          blocks,
          lastPlayedBlock
        );
        timeCursor = pushed.timeCursor;
        lastPlayedBlock = pushed.lastPlayedBlock;
      }

      if (block.type === 'PROMO' || block.type === 'STATION_ID') {
        state.typePlayCounts['MOVIE'] = 0;
        state.minutesSinceReset = 0;
      }

      state.blockIndex = (state.blockIndex + 1) % blocks.length;
    }

    state.rngCounter = rngCounter;
    return { segments, state, warnings };
  }

  simulate(
    blocks: BlueprintBlock[],
    playlists: Map<string, PlaylistContentSource>,
    horizon: SimulationResult['horizon'],
    startTime: Date = new Date(),
    initialState?: BlueprintRuntimeState,
    seed?: number,
    source: ExecutionSource = 'TIMELINE'
  ): SimulationResult {
    const endMs = startTime.getTime() + HORIZON_MS[horizon];
    const rngSeed = seed ?? startTime.getTime();

    const estimatedSegments = Math.min(
      8000,
      Math.ceil(HORIZON_MS[horizon] / 30_000) + blocks.length * 32
    );

    const { segments, state, warnings } = this.resolveSegments({
      blocks,
      playlists,
      count: estimatedSegments,
      startTime,
      initialState,
      seed: rngSeed,
      source,
    });

    const allSegments = segments.filter((s) => new Date(s.startsAt).getTime() < endMs);
    let allWarnings = [...warnings, ...this.detectRepetition(allSegments)];

    const targetSec = HORIZON_MS[horizon] / 1000;
    const totalDurationSec = allSegments.reduce((s, seg) => s + seg.durationSec, 0);
    if (totalDurationSec < targetSec * 0.5 && allSegments.length > 0) {
      allWarnings.push(
        warn(
          'LOW_COVERAGE',
          `Coverage below target (${Math.round(totalDurationSec / 3600)}h of ${Math.round(targetSec / 3600)}h)`,
          'Add more content to playlists or shorten blocks so the simulator can fill the timeline.',
          undefined,
          'warning'
        )
      );
    }

    const uniqueTitles = new Set(allSegments.map((s) => s.title)).size;

    return {
      horizon,
      startedAt: startTime.toISOString(),
      endedAt: new Date(endMs).toISOString(),
      segments: allSegments,
      warnings: this.dedupeWarnings(allWarnings),
      stats: {
        totalSegments: allSegments.length,
        totalDurationSec,
        uniqueTitles,
        cycleCount: state.cycleCount,
      },
    };
  }

  private detectRepetition(segments: ResolvedSegment[]): SimulationWarning[] {
    const warnings: SimulationWarning[] = [];
    const window = 8;
    for (let i = window; i < segments.length; i++) {
      const current = segments[i].title;
      const prev = segments.slice(i - window, i).map((s) => s.title);
      if (prev.filter((t) => t === current).length >= 2) {
        warnings.push(
          warn(
            'REPETITION',
            `"${current}" appears frequently in the schedule`,
            'Add more videos to the playlist or increase random pool size.',
            segments[i].blockId,
            'warning'
          )
        );
        break;
      }
    }
    return warnings;
  }

  private dedupeWarnings(warnings: SimulationWarning[]): SimulationWarning[] {
    const seen = new Set<string>();
    return warnings.filter((w) => {
      const key = `${w.code}:${w.blockId || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

export const blueprintEngineService = new BlueprintEngineService();
