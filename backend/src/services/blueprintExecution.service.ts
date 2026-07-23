import { logger } from '../utils/logger';
import {
  blueprintEngineService,
  formatCursorState,
  type PlaylistContentSource,
} from './blueprintEngine.service';
import type {
  BlueprintBlock,
  BlueprintRuntimeState,
  ResolvedSegment,
  SimulationResult,
} from '../types/blueprint.types';

export type ExecutionSource = 'ENGINE' | 'TIMELINE' | 'VERIFY';

const HORIZON_MS: Record<SimulationResult['horizon'], number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
};

export interface ExecuteBlueprintOptions {
  blocks: BlueprintBlock[];
  playlists: Map<string, PlaylistContentSource>;
  count: number;
  startTime?: Date;
  initialState?: BlueprintRuntimeState;
  seed?: number;
  source?: ExecutionSource;
  debug?: boolean;
}

export interface ExecuteBlueprintResult {
  segments: ResolvedSegment[];
  state: BlueprintRuntimeState;
  warnings: ReturnType<typeof blueprintEngineService.analyzeBlueprint>;
}

export interface SimulateHorizonOptions {
  blocks: BlueprintBlock[];
  playlists: Map<string, PlaylistContentSource>;
  horizon: SimulationResult['horizon'];
  startTime?: Date;
  initialState?: BlueprintRuntimeState;
  seed?: number;
  source?: ExecutionSource;
  debug?: boolean;
}

export interface DriftMismatch {
  index: number;
  field: string;
  timeline: string;
  engine: string;
}

export interface DriftReport {
  ok: boolean;
  compared: number;
  mismatches: DriftMismatch[];
}

export interface DivergencePoint {
  index: number;
  field: string;
  engine: {
    blockLabel: string;
    blockType: string;
    title: string;
    durationSec: number;
    startsAt: string;
  };
  timeline: {
    blockLabel: string;
    blockType: string;
    title: string;
    durationSec: number;
    startsAt: string;
  };
  engineCursors: string;
  timelineCursors: string;
}

export interface ConsistencyReport {
  ok: boolean;
  segmentCounts: number[];
  results: Array<{
    segmentCount: number;
    ok: boolean;
    compared: number;
    firstDivergence: DivergencePoint | null;
    mismatches: DriftMismatch[];
  }>;
}

class BlueprintExecutionService {
  executionSeed(channelId: string, blueprintId: string): number {
    let h = 2166136261;
    const s = `${channelId}:${blueprintId}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  execute(options: ExecuteBlueprintOptions): ExecuteBlueprintResult {
    const {
      blocks,
      playlists,
      count,
      startTime = new Date(),
      initialState,
      seed = Date.now(),
      source = 'ENGINE',
    } = options;

    try {
      return blueprintEngineService.resolveSegments({
        blocks,
        playlists,
        count,
        startTime,
        initialState,
        seed,
        source,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        `[EXECUTION_ERROR] blockType=unknown media=unknown ` +
          `cursorState={${initialState ? formatCursorState(initialState, blocks) : 'none'}} error=${message}`
      );
      throw err;
    }
  }

  simulateHorizon(options: SimulateHorizonOptions): SimulationResult {
    const {
      blocks,
      playlists,
      horizon,
      startTime = new Date(),
      initialState,
      seed = startTime.getTime(),
      source = 'TIMELINE',
      debug = process.env.BLUEPRINT_EXEC_DEBUG === '1',
    } = options;

    if (debug) {
      process.env.BLUEPRINT_EXEC_DEBUG = '1';
    }

    return blueprintEngineService.simulate(
      blocks,
      playlists,
      horizon,
      startTime,
      initialState,
      seed,
      source
    );
  }

  verifyDeterminism(
    blocks: BlueprintBlock[],
    playlists: Map<string, PlaylistContentSource>,
    segmentCount: number,
    startTime: Date,
    initialState?: BlueprintRuntimeState,
    seed?: number
  ): DriftReport {
    const a = this.execute({
      blocks,
      playlists,
      count: segmentCount,
      startTime,
      initialState,
      seed,
      source: 'TIMELINE',
    });
    const b = this.execute({
      blocks,
      playlists,
      count: segmentCount,
      startTime,
      initialState,
      seed,
      source: 'ENGINE',
    });

    return compareSegmentLists(a.segments, b.segments);
  }

  /**
   * Compare single-pass execute() vs simulate() — must be identical for all segment counts.
   */
  verifyExecutionConsistency(
    blocks: BlueprintBlock[],
    playlists: Map<string, PlaylistContentSource>,
    segmentCounts: number[] = [48, 96, 500],
    startTime: Date = new Date(),
    initialState?: BlueprintRuntimeState,
    seed?: number
  ): ConsistencyReport {
    const rngSeed = seed ?? startTime.getTime();
    const results: ConsistencyReport['results'] = [];

    for (const segmentCount of segmentCounts) {
      const engineRun = this.execute({
        blocks,
        playlists,
        count: segmentCount,
        startTime,
        initialState,
        seed: rngSeed,
        source: 'ENGINE',
      });

      const horizon: SimulationResult['horizon'] =
        segmentCount <= 48 ? '1h' : segmentCount <= 200 ? '24h' : '7d';
      const timelineRun = blueprintEngineService.simulate(
        blocks,
        playlists,
        horizon,
        startTime,
        initialState,
        rngSeed,
        'TIMELINE'
      );

      const timelineSegments = timelineRun.segments.slice(0, segmentCount);
      const drift = compareSegmentLists(timelineSegments, engineRun.segments);
      const firstDivergence = drift.mismatches.length
        ? buildDivergencePoint(
            drift.mismatches[0].index,
            timelineSegments,
            engineRun.segments,
            blocks,
            engineRun.state,
            engineRun.state
          )
        : null;

      if (firstDivergence) {
        logger.error(
          `DIVERGENCE FOUND\nSegment #${firstDivergence.index + 1}\n` +
            `Engine: ${firstDivergence.engine.blockLabel} -> ${firstDivergence.engine.title}\n` +
            `Timeline: ${firstDivergence.timeline.blockLabel} -> ${firstDivergence.timeline.title}\n` +
            `Cursor State:\n  engine={${firstDivergence.engineCursors}}\n  timeline={${firstDivergence.timelineCursors}}`
        );
      }

      results.push({
        segmentCount,
        ok: drift.ok,
        compared: drift.compared,
        firstDivergence,
        mismatches: drift.mismatches,
      });
    }

    return {
      ok: results.every((r) => r.ok),
      segmentCounts,
      results,
    };
  }
}

function buildDivergencePoint(
  index: number,
  timelineSegs: ResolvedSegment[],
  engineSegs: ResolvedSegment[],
  blocks: BlueprintBlock[],
  engineState: BlueprintRuntimeState,
  timelineState: BlueprintRuntimeState
): DivergencePoint | null {
  const engine = engineSegs[index];
  const timeline = timelineSegs[index];
  if (!engine || !timeline) return null;

  return {
    index,
    field: 'selected_media',
    engine: {
      blockLabel: engine.blockLabel,
      blockType: engine.blockType,
      title: engine.title,
      durationSec: engine.durationSec,
      startsAt: engine.startsAt,
    },
    timeline: {
      blockLabel: timeline.blockLabel,
      blockType: timeline.blockType,
      title: timeline.title,
      durationSec: timeline.durationSec,
      startsAt: timeline.startsAt,
    },
    engineCursors: formatCursorState(engineState, blocks),
    timelineCursors: formatCursorState(timelineState, blocks),
  };
}

function compareSegmentLists(a: ResolvedSegment[], b: ResolvedSegment[]): DriftReport {
  const mismatches: DriftMismatch[] = [];
  const compared = Math.min(a.length, b.length);

  for (let i = 0; i < compared; i++) {
    const left = a[i];
    const right = b[i];
    if (left.startsAt !== right.startsAt) {
      mismatches.push({ index: i, field: 'startsAt', timeline: left.startsAt, engine: right.startsAt });
    }
    if (left.blockId !== right.blockId) {
      mismatches.push({ index: i, field: 'blockId', timeline: left.blockId, engine: right.blockId });
    }
    if (left.playlistId !== right.playlistId) {
      mismatches.push({
        index: i,
        field: 'playlistId',
        timeline: String(left.playlistId),
        engine: String(right.playlistId),
      });
    }
    if (left.itemId !== right.itemId) {
      mismatches.push({
        index: i,
        field: 'selected_media',
        timeline: String(left.title),
        engine: String(right.title),
      });
    }
    if (Math.abs(left.durationSec - right.durationSec) > 0.5) {
      mismatches.push({
        index: i,
        field: 'duration',
        timeline: String(left.durationSec),
        engine: String(right.durationSec),
      });
    }
  }

  if (a.length !== b.length) {
    mismatches.push({
      index: compared,
      field: 'length',
      timeline: String(a.length),
      engine: String(b.length),
    });
  }

  return { ok: mismatches.length === 0, compared, mismatches };
}

export const blueprintExecutionService = new BlueprintExecutionService();
