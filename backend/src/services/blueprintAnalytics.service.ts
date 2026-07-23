import type {
  BlueprintBlock,
  BlueprintSummary,
  CoverageBreakdown,
  PlaylistInsight,
  SimulationResult,
} from '../types/blueprint.types';
import type { PlaylistContentSource } from './blueprintEngine.service';
import { blueprintEngineService } from './blueprintEngine.service';

const DEFAULT_ITEM_DURATION = 120;

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

class BlueprintAnalyticsService {
  buildPlaylistInsights(playlists: Map<string, PlaylistContentSource>): PlaylistInsight[] {
    return [...playlists.values()].map((pl) => {
      const durationSec = pl.items.reduce((s, i) => s + (i.durationSec || DEFAULT_ITEM_DURATION), 0);
      return {
        id: pl.id,
        name: pl.name,
        itemCount: pl.items.length,
        durationSec,
        formattedDuration: formatDuration(durationSec),
      };
    });
  }

  /** Estimate one loop cycle duration by simulating until LOOP cycle increments. */
  estimateLoopDuration(blocks: BlueprintBlock[], playlists: Map<string, PlaylistContentSource>): number {
    const { segments, state } = blueprintEngineService.resolveSegments({
      blocks,
      playlists,
      count: 200,
      startTime: new Date(),
      seed: 42,
      source: 'TIMELINE',
    });
    if (state.cycleCount > 0) {
      return segments.reduce((s, seg) => s + seg.durationSec, 0);
    }
    return segments.reduce((s, seg) => s + seg.durationSec, 0);
  }

  computeSummary(blocks: BlueprintBlock[], playlists: Map<string, PlaylistContentSource>): BlueprintSummary {
    const playlistInsights = this.buildPlaylistInsights(playlists);
    const uniqueAssetIds = new Set<string>();
    let movies = 0;
    let promos = 0;
    let stationIds = 0;
    let intros = 0;
    let music = 0;
    let cartoons = 0;
    let supers = 0;

    for (const block of blocks) {
      if (block.type === 'LOOP') continue;
      const pl = block.config.playlistId ? playlists.get(block.config.playlistId) : undefined;
      if (pl) pl.items.forEach((i) => uniqueAssetIds.add(i.id));

      switch (block.type) {
        case 'MOVIE':
          movies += pl?.items.length ?? 0;
          break;
        case 'PROMO':
          promos += pl?.items.length ?? 0;
          break;
        case 'STATION_ID':
          stationIds += pl?.items.length ?? 0;
          break;
        case 'INTRO':
          intros += pl?.items.length ?? 0;
          break;
        case 'MUSIC':
          music += pl?.items.length ?? 0;
          break;
        case 'CARTOON':
          cartoons += pl?.items.length ?? 0;
          break;
        case 'SUPER':
          supers += pl?.items.length ?? 0;
          break;
        default:
          break;
      }
    }

    const estimatedLoopDurationSec = this.estimateLoopDuration(blocks, playlists);
    const coverageHours = estimatedLoopDurationSec / 3600;

    let repeatRisk: BlueprintSummary['repeatRisk'] = 'LOW';
    const movieBlocks = blocks.filter((b) => b.type === 'MOVIE' && b.config.selectionMode === 'RANDOM');
    for (const mb of movieBlocks) {
      const pl = mb.config.playlistId ? playlists.get(mb.config.playlistId) : undefined;
      const pool = pl?.items.length ?? 0;
      if (pool <= 1) repeatRisk = 'HIGH';
      else if (pool < 5 && repeatRisk !== 'HIGH') repeatRisk = 'MEDIUM';
    }
    if (estimatedLoopDurationSec > 0 && uniqueAssetIds.size > 0) {
      const loopsPerWeek = (7 * 24 * 3600) / estimatedLoopDurationSec;
      if (loopsPerWeek > uniqueAssetIds.size * 2) repeatRisk = 'HIGH';
      else if (loopsPerWeek > uniqueAssetIds.size && repeatRisk === 'LOW') repeatRisk = 'MEDIUM';
    }

    let blueprintScore = 100;
    if (!blocks.some((b) => b.type === 'LOOP')) blueprintScore -= 25;
    if (!blocks.some((b) => b.type === 'STATION_ID' && b.config.playlistId)) blueprintScore -= 10;
    for (const block of blocks) {
      if (block.type === 'LOOP') continue;
      if (!block.config.playlistId) blueprintScore -= 12;
      else {
        const pl = playlists.get(block.config.playlistId);
        if (!pl || pl.items.length === 0) blueprintScore -= 15;
        else if (pl.items.length === 1) blueprintScore -= 8;
      }
    }
    if (repeatRisk === 'HIGH') blueprintScore -= 20;
    else if (repeatRisk === 'MEDIUM') blueprintScore -= 10;
    blueprintScore = Math.max(0, Math.min(100, blueprintScore));

    const repeatRiskLabel =
      repeatRisk === 'LOW' ? 'Low' : repeatRisk === 'MEDIUM' ? 'Medium' : 'High';

    return {
      blockCounts: { movies, promos, stationIds, intros, music, cartoons, supers },
      estimatedLoopDurationSec,
      estimatedLoopFormatted: formatDuration(estimatedLoopDurationSec),
      uniqueAssets: uniqueAssetIds.size,
      repeatRisk,
      repeatRiskLabel,
      blueprintScore,
      coverageHours,
      coverageFormatted: formatDuration(estimatedLoopDurationSec),
      playlistInsights,
    };
  }

  enrichSimulation(sim: SimulationResult, blocks: BlueprintBlock[], playlists: Map<string, PlaylistContentSource>): SimulationResult {
    const unique = sim.stats.uniqueTitles;
    const total = sim.stats.totalSegments;
    const repeatRatio = total > 0 ? 1 - unique / total : 0;

    let diversityScore = 100;
    if (repeatRatio > 0.5) diversityScore -= 40;
    else if (repeatRatio > 0.3) diversityScore -= 25;
    else if (repeatRatio > 0.15) diversityScore -= 10;

    const moviePool = blocks
      .filter((b) => b.type === 'MOVIE')
      .reduce((s, b) => s + (playlists.get(b.config.playlistId || '')?.items.length ?? 0), 0);
    if (moviePool >= 20) diversityScore += 5;
    diversityScore = Math.max(0, Math.min(100, diversityScore));

    const reasons: string[] = [];
    if (moviePool > 0) reasons.push(`${moviePool} movies in pool`);
    reasons.push(`${unique} unique titles in window`);
    reasons.push(repeatRatio < 0.2 ? 'Low repetition' : 'Some repetition detected');

    const byType: Record<string, number> = {};
    for (const seg of sim.segments) {
      byType[seg.blockType] = (byType[seg.blockType] || 0) + seg.durationSec;
    }

    const breakdown: CoverageBreakdown[] = Object.entries(byType).map(([blockType, durationSec]) => ({
      label: blockType.replace(/_/g, ' '),
      blockType: blockType as CoverageBreakdown['blockType'],
      durationSec,
      formatted: formatDuration(durationSec),
    }));

    return {
      ...sim,
      diversity: {
        score: diversityScore,
        label: diversityScore >= 85 ? 'Excellent' : diversityScore >= 65 ? 'Good' : 'Needs attention',
        reasons,
      },
      coverage: {
        totalDurationSec: sim.stats.totalDurationSec,
        formatted: formatDuration(sim.stats.totalDurationSec),
        breakdown,
      },
    };
  }
}

export const blueprintAnalyticsService = new BlueprintAnalyticsService();
