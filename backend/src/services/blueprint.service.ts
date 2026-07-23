import { prisma } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { BLUEPRINT_TEMPLATES, instantiateTemplate } from '../config/blueprintTemplates';
import fs from 'fs';
import {
  blueprintEngineService,
  type PlaylistContentSource,
} from './blueprintEngine.service';
import { blueprintAnalyticsService } from './blueprintAnalytics.service';
import { blueprintExecutionService } from './blueprintExecution.service';
import { blueprintPlaybackService } from './blueprintPlayback.service';
import { blueprintWindowAuditService } from './blueprintWindowAudit.service';
import type { BlueprintBlock, BlueprintSummary, BlueprintLiveCursor, ResolvedSegment, SimulationResult } from '../types/blueprint.types';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export interface PublishBlueprintResult {
  blueprint: ChannelBlueprintRow;
  channel: { id: string; name: string; status: string };
  playbackMode: 'BLUEPRINT';
  blueprintName: string;
  status: 'Active' | 'Pending restart';
  streamRestarted: boolean;
  segmentCount: number;
  warnings: string[];
}

type ChannelBlueprintRow = Awaited<ReturnType<BlueprintService['getById']>>;

class BlueprintService {
  async loadPlaylistSources(playlistIds: string[]): Promise<Map<string, PlaylistContentSource>> {
    const unique = [...new Set(playlistIds.filter(Boolean))];
    const map = new Map<string, PlaylistContentSource>();
    if (unique.length === 0) return map;

    const rows = await prisma.playlist.findMany({
      where: { id: { in: unique } },
      include: {
        items: {
          where: { status: 'READY' },
          orderBy: { position: 'asc' },
        },
      },
    });

    const { probeMediaDurationSec } = await import('./mediaProbe.service');

    for (const pl of rows) {
      const items = await Promise.all(
        pl.items.map(async (item) => {
          const probed = item.videoPath ? await probeMediaDurationSec(item.videoPath) : undefined;
          const dbDuration = item.duration ?? 120;
          const durationSec = probed ?? dbDuration;
          return {
            id: item.id,
            originalFilename: item.originalFilename,
            durationSec,
            videoPath: item.videoPath,
          };
        })
      );
      map.set(pl.id, {
        id: pl.id,
        name: pl.name,
        items,
      });
    }
    return map;
  }

  private extractPlaylistIds(blocks: BlueprintBlock[]): string[] {
    return blocks
      .map((b) => b.config?.playlistId)
      .filter((id): id is string => !!id);
  }

  private parseBlocks(raw: unknown): BlueprintBlock[] {
    if (!Array.isArray(raw)) return [];
    return raw as BlueprintBlock[];
  }

  parseBlocksFromJson(raw: unknown): BlueprintBlock[] {
    return this.parseBlocks(raw);
  }

  async getAll() {
    return prisma.channelBlueprint.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { channel: { select: { id: true, name: true, slug: true, status: true } } },
    });
  }

  async getById(id: string) {
    const row = await prisma.channelBlueprint.findUnique({
      where: { id },
      include: { channel: { select: { id: true, name: true, slug: true, status: true } } },
    });
    if (!row) throw new AppError('Blueprint not found', 404);
    return { ...row, blocks: this.parseBlocks(row.blocks) };
  }

  async createFromTemplate(templateKey: string, name?: string) {
    const tpl = BLUEPRINT_TEMPLATES.find((t) => t.key === templateKey);
    if (!tpl) throw new AppError('Template not found', 404);

    const blocks = instantiateTemplate(templateKey);
    return prisma.channelBlueprint.create({
      data: {
        name: name?.trim() || tpl.name,
        description: tpl.description,
        templateKey,
        blocks: blocks as object[],
      },
    });
  }

  async create(data: { name: string; description?: string; blocks?: BlueprintBlock[] }) {
    const blocks = data.blocks?.length ? data.blocks : [{ id: uuidv4(), type: 'LOOP' as const, label: 'Loop', config: {} }];
    return prisma.channelBlueprint.create({
      data: {
        name: data.name.trim(),
        description: data.description,
        blocks: blocks as object[],
      },
    });
  }

  async update(
    id: string,
    data: { name?: string; description?: string; blocks?: BlueprintBlock[]; status?: 'DRAFT' | 'PUBLISHED' }
  ) {
    await this.getById(id);
    const row = await prisma.channelBlueprint.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.blocks !== undefined ? { blocks: data.blocks as object[] } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
      include: { channel: { select: { id: true, status: true, useBlueprint: true } } },
    });

    if (data.blocks !== undefined && row.channel?.useBlueprint && row.channel.id) {
      const playlistIds = this.extractPlaylistIds(this.parseBlocks(row.blocks));
      logger.info(
        `[BLUEPRINT_STATE] channelId=${row.channel.id} blueprintId=${id} ` +
          `event=blueprint_definition_updated runtimeWindowRebuilt=false timelineInvalidated=false ` +
          `playlistVersion=pending_refresh blueprintVersion=${id}@${row.updatedAt.toISOString()}`
      );
      blueprintWindowAuditService.logBlueprintState({
        channelId: row.channel.id,
        blueprintId: id,
        playlistIds,
      });
    }

    return { ...row, blocks: this.parseBlocks(row.blocks) };
  }

  async delete(id: string) {
    const row = await this.getById(id);
    if (row.channel?.id) {
      await this.unpublishFromChannel(row.channel.id, false);
    }
    await prisma.channelBlueprint.delete({ where: { id } });
    return { message: 'Blueprint deleted' };
  }

  /** Remove blueprint from a channel and return to playlist playback. */
  async unpublishFromChannel(channelId: string, restartIfRunning = true) {
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new AppError('Channel not found', 404);
    if (!channel.blueprintId && !channel.useBlueprint) {
      return { message: 'Channel is not using a blueprint' };
    }

    const wasRunning =
      restartIfRunning && (channel.status === 'ONLINE' || channel.status === 'STARTING' || channel.status === 'ERROR');

    await prisma.channel.update({
      where: { id: channelId },
      data: { blueprintId: null, useBlueprint: false },
    });

    const { blueprintPlaybackService } = await import('./blueprintPlayback.service');
    blueprintPlaybackService.clearRuntime(channelId);

    if (wasRunning) {
      const { channelService } = await import('./channel.service');
      await channelService.restartChannel(channelId);
    }

    return { message: 'Blueprint unpublished from channel' };
  }

  async getSummary(id: string, blocksOverride?: unknown): Promise<BlueprintSummary> {
    const row = await this.getById(id);
    const blocks = blocksOverride ? this.parseBlocks(blocksOverride) : this.parseBlocks(row.blocks);
    const playlists = await this.loadPlaylistSources(this.extractPlaylistIds(blocks));
    return blueprintAnalyticsService.computeSummary(blocks, playlists);
  }

  /**
   * Map playback engine segment to timeline row — blockId + itemId + occurrenceIndex only.
   */
  resolveTimelineByPlaybackSegment(
    timelineSegments: ResolvedSegment[],
    runtimeSegment: ResolvedSegment,
    channelId: string,
    currentIndex: number,
    context?: {
      playbackEpoch?: number;
      timelinePlaybackEpoch?: number | null;
    }
  ): {
    index: number | null;
    segment: ResolvedSegment | null;
    matchFound: boolean;
    failureReason?: string;
  } {
    const { blockId, itemId, occurrenceIndex, title } = runtimeSegment;
    const timelineLength = timelineSegments.length;
    const playbackEpoch = context?.playbackEpoch ?? 0;
    const timelinePlaybackEpoch = context?.timelinePlaybackEpoch ?? null;

    const logLookup = (
      matchedTimelineIndex: number | null,
      matchFound: boolean,
      failureReason?: string
    ) => {
      logger.info(
        `[TIMELINE_LOOKUP] channelId=${channelId} playbackEpoch=${playbackEpoch} ` +
          `timelinePlaybackEpoch=${timelinePlaybackEpoch ?? 'none'} ` +
          `currentIndex=${currentIndex} currentMedia=${title} ` +
          `blockId=${blockId} itemId=${itemId ?? 'none'} occurrenceIndex=${occurrenceIndex ?? 'missing'} ` +
          `timelineLength=${timelineLength} matchedTimelineIndex=${matchedTimelineIndex ?? 'none'} ` +
          `matchFound=${matchFound}` +
          (failureReason ? ` failureReason=${failureReason}` : '')
      );
    };

    if (!itemId || occurrenceIndex == null || !Number.isFinite(occurrenceIndex)) {
      const failureReason = 'invalid_runtime_segment_missing_identity';
      logger.warn(
        `[TIMELINE_SEGMENT_NOT_FOUND] channelId=${channelId} currentMedia=${title} ` +
          `currentIndex=${currentIndex} blockId=${blockId} itemId=${itemId ?? 'none'} ` +
          `occurrenceIndex=${occurrenceIndex ?? 'missing'} reason=${failureReason}`
      );
      logLookup(null, false, failureReason);
      return { index: null, segment: null, matchFound: false, failureReason };
    }

    if (
      timelinePlaybackEpoch != null &&
      playbackEpoch > 0 &&
      timelinePlaybackEpoch !== playbackEpoch
    ) {
      const failureReason = `playback_epoch_mismatch runtime=${playbackEpoch} timeline=${timelinePlaybackEpoch}`;
      logLookup(null, false, failureReason);
      return { index: null, segment: null, matchFound: false, failureReason };
    }

    const matches = timelineSegments
      .map((s, i) => ({ s, i }))
      .filter(
        ({ s }) =>
          s.blockId === blockId &&
          s.itemId === itemId &&
          s.occurrenceIndex === occurrenceIndex
      );

    if (matches.length === 1) {
      const { s, i } = matches[0];
      logLookup(i, true);
      return { index: i, segment: s, matchFound: true };
    }

    if (matches.length > 1) {
      logger.warn(
        `[TIMELINE_AMBIGUOUS] channelId=${channelId} currentMedia=${title} matchesFound=${matches.length} ` +
          `blockId=${blockId} itemId=${itemId} occurrenceIndex=${occurrenceIndex}`
      );
      const { s, i } = matches[0];
      logLookup(i, true, 'ambiguous_first_match');
      return { index: i, segment: s, matchFound: true, failureReason: 'ambiguous_first_match' };
    }

    const sameIdentity = timelineSegments.filter(
      (s) => s.blockId === blockId && s.itemId === itemId
    );
    const maxOccInTimeline =
      sameIdentity.length > 0
        ? Math.max(...sameIdentity.map((s) => s.occurrenceIndex ?? -1))
        : -1;
    const minOccInTimeline =
      sameIdentity.length > 0
        ? Math.min(...sameIdentity.map((s) => s.occurrenceIndex ?? 0))
        : -1;

    let failureReason: string;
    if (sameIdentity.length === 0) {
      failureReason = `identity_not_in_timeline blockId=${blockId} itemId=${itemId}`;
    } else if (occurrenceIndex > maxOccInTimeline) {
      failureReason =
        `occurrence_beyond_timeline runtimeOcc=${occurrenceIndex} ` +
        `maxInTimeline=${maxOccInTimeline} identityRows=${sameIdentity.length}`;
    } else if (occurrenceIndex < minOccInTimeline) {
      failureReason =
        `occurrence_before_timeline runtimeOcc=${occurrenceIndex} ` +
        `minInTimeline=${minOccInTimeline} identityRows=${sameIdentity.length}`;
    } else {
      failureReason =
        `occurrence_gap runtimeOcc=${occurrenceIndex} ` +
        `minInTimeline=${minOccInTimeline} maxInTimeline=${maxOccInTimeline}`;
    }

    logger.warn(
      `[TIMELINE_SEGMENT_NOT_FOUND] channelId=${channelId} currentMedia=${title} ` +
        `currentIndex=${currentIndex} blockId=${blockId} itemId=${itemId} occurrenceIndex=${occurrenceIndex} ` +
        `reason=${failureReason}`
    );
    logLookup(null, false, failureReason);
    return { index: null, segment: null, matchFound: false, failureReason };
  }

  /** Regenerate server timeline cache after window roll — does not touch playback. */
  async regenerateTimelineCacheForChannel(blueprintId: string, channelId: string): Promise<void> {
    try {
      const row = await prisma.channelBlueprint.findUnique({ where: { id: blueprintId } });
      if (!row) return;
      const blocks = this.parseBlocks(row.blocks);
      const playlists = await this.loadPlaylistSources(this.extractPlaylistIds(blocks));
      const runtimeEpoch = blueprintPlaybackService.getPlaybackEpoch(channelId);
      await this.generateTimeline(blocks, playlists, '24h', blueprintId, channelId);
      logger.info(
        `[TIMELINE_REGEN] blueprintId=${blueprintId} channelId=${channelId} ` +
          `horizon=24h playbackEpoch=${runtimeEpoch}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        `[TIMELINE_REGEN] blueprintId=${blueprintId} channelId=${channelId} failed=${message}`
      );
    }
  }

  private pickLiveTimelineHorizon(
    requested: SimulationResult['horizon'],
    scheduleAnchorMs: number,
    scheduleCursorMs: number
  ): SimulationResult['horizon'] {
    const spanMs = Math.max(0, scheduleCursorMs - scheduleAnchorMs);
    const twentyHours = 20 * 60 * 60 * 1000;
    if (spanMs > twentyHours) return '7d';
    if (requested === '1h' && spanMs > 45 * 60 * 1000) return '24h';
    return requested;
  }

  private timelineCachePlaybackEpoch(
    blueprintId: string,
    horizon: SimulationResult['horizon']
  ): number | null {
    try {
      const file = this.timelineCachePath(blueprintId, horizon);
      if (!fs.existsSync(file)) return null;
      const cached = JSON.parse(fs.readFileSync(file, 'utf8')) as { playbackEpoch?: number };
      return cached.playbackEpoch ?? null;
    } catch {
      return null;
    }
  }

  private timelineCachePath(blueprintId: string, horizon: SimulationResult['horizon']): string {
    const dir = path.join(env.STREAMS_DIR, 'blueprints', 'cache');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${blueprintId}-${horizon}.json`);
  }

  saveTimelineCache(
    blueprintId: string,
    horizon: SimulationResult['horizon'],
    data: SimulationResult,
    blueprintUpdatedAt: string,
    playbackEpoch = 0
  ): void {
    try {
      const file = this.timelineCachePath(blueprintId, horizon);
      fs.writeFileSync(
        file,
        JSON.stringify({ blueprintUpdatedAt, playbackEpoch, savedAt: new Date().toISOString(), data }),
        'utf8'
      );
    } catch {
      /* non-fatal */
    }
  }

  loadTimelineCache(
    blueprintId: string,
    horizon: SimulationResult['horizon'],
    blueprintUpdatedAt: string,
    requiredPlaybackEpoch?: number
  ): SimulationResult | null {
    try {
      const file = this.timelineCachePath(blueprintId, horizon);
      if (!fs.existsSync(file)) return null;
      const cached = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        blueprintUpdatedAt: string;
        playbackEpoch?: number;
        data: SimulationResult;
      };
      if (cached.blueprintUpdatedAt !== blueprintUpdatedAt) return null;
      if (
        requiredPlaybackEpoch != null &&
        (cached.playbackEpoch ?? 0) !== requiredPlaybackEpoch
      ) {
        return null;
      }
      if (cached.data.segments?.some((s) => s.occurrenceIndex == null)) {
        this.invalidateTimelineCaches(blueprintId, 'missing_occurrence_index');
        return null;
      }
      return cached.data;
    } catch {
      return null;
    }
  }

  invalidateTimelineCaches(blueprintId: string, reason: string): void {
    for (const h of ['1h', '24h', '7d'] as SimulationResult['horizon'][]) {
      const file = this.timelineCachePath(blueprintId, h);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    logger.info(`[TIMELINE_INVALIDATED] blueprintId=${blueprintId} reason=${reason}`);
  }

  async getLiveCursor(
    blueprintId: string,
    channelId: string,
    timelineSegments?: ResolvedSegment[],
    horizon: SimulationResult['horizon'] = '24h'
  ): Promise<BlueprintLiveCursor> {
    const runtime = blueprintPlaybackService.getRuntime(channelId);
    const runtimeEpoch = runtime?.playbackEpoch ?? blueprintPlaybackService.getPlaybackEpoch(channelId);
    const timelineCacheEpoch = this.timelineCachePlaybackEpoch(blueprintId, horizon);

    let segments = timelineSegments;
    let segmentsSource: 'request' | 'cache' | 'none' = timelineSegments?.length ? 'request' : 'none';
    if (!segments?.length) {
      const cached = await this.getCachedTimeline(blueprintId, horizon, channelId);
      segments = cached?.segments;
      if (segments?.length) segmentsSource = 'cache';
    }

    const cursor = await blueprintPlaybackService.getLiveCursor(channelId, blueprintId);
    const windowSeg = runtime?.segments[runtime.currentIndex];

    let timelineIndex: number | null = null;
    let timelineSegment: BlueprintLiveCursor['timelineSegment'] = null;
    let timelineMatchMethod: string | null = null;

    if (!segments?.length && windowSeg && runtime) {
      logger.warn(
        `[TIMELINE_LOOKUP] channelId=${channelId} playbackEpoch=${runtimeEpoch} ` +
          `timelinePlaybackEpoch=${timelineCacheEpoch ?? 'none'} currentIndex=${runtime.currentIndex} ` +
          `currentMedia=${windowSeg.title} occurrenceIndex=${windowSeg.occurrenceIndex ?? 'missing'} ` +
          `timelineLength=0 matchedTimelineIndex=none matchFound=false ` +
          `failureReason=timeline_cache_miss segmentsSource=${segmentsSource}`
      );
    }

    if (segments?.length && windowSeg && runtime) {
      const match = this.resolveTimelineByPlaybackSegment(
        segments,
        windowSeg,
        channelId,
        runtime.currentIndex,
        { playbackEpoch: runtimeEpoch, timelinePlaybackEpoch: timelineCacheEpoch }
      );
      timelineIndex = match.index;
      timelineMatchMethod = match.matchFound ? 'segment_identity' : 'none';
      if (match.segment) {
        timelineSegment = {
          blockLabel: match.segment.blockLabel,
          title: match.segment.title,
          startsAt: match.segment.startsAt,
          endsAt: match.segment.endsAt,
        };
      }

      if (!match.matchFound && match.failureReason?.includes('beyond_timeline')) {
        void this.regenerateTimelineCacheForChannel(blueprintId, channelId);
      }

      const wallNow = cursor.now;
      const rawStartsAt = timelineSegment?.startsAt ?? windowSeg.startsAt;
      const rawDate = new Date(rawStartsAt);
      const displayOffsetMs = Date.parse(wallNow) - rawDate.getTime();
      logger.info(
        `[TIME_DEBUG] channelId=${channelId} rawStartsAt=${rawStartsAt} ` +
          `utcStartsAt=${rawDate.toISOString()} ` +
          `localStartsAt=${rawDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ` +
          `displayedTime=${new Date(rawDate.getTime() + displayOffsetMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ` +
          `timezoneOffsetMinutes=${-new Date().getTimezoneOffset()} ` +
          `displayOffsetMs=${displayOffsetMs} ` +
          `scheduleAnchorMs=${runtime.scheduleAnchorMs} ` +
          `windowScheduleStartMs=${runtime.windowScheduleStartMs} wallNow=${wallNow}`
      );
    }

    const currentMedia = cursor.current?.title ?? null;
    const nowPlayingDiag = await blueprintPlaybackService.getDiagnostics(channelId);
    const nowPlayingMedia = nowPlayingDiag?.currentAsset ?? null;
    const timelineMedia = timelineSegment?.title ?? null;

    let inSync = true;
    let mismatch: string | null = null;
    if (currentMedia && nowPlayingMedia && currentMedia !== nowPlayingMedia) {
      inSync = false;
      mismatch = `FFmpeg=${currentMedia} vs NowPlaying=${nowPlayingMedia}`;
    } else if (currentMedia && timelineMedia && currentMedia !== timelineMedia) {
      inSync = false;
      mismatch = `FFmpeg=${currentMedia} vs Timeline=${timelineMedia}`;
    }

    if (runtime && segments?.length && windowSeg) {
      const bpRow = await prisma.channelBlueprint.findUnique({
        where: { id: blueprintId },
        select: { blocks: true },
      });
      const playlistIds = bpRow ? this.extractPlaylistIds(this.parseBlocks(bpRow.blocks)) : [];
      const forceAudit =
        timelineIndex == null ||
        (timelineSegment?.title != null && windowSeg.title !== timelineSegment.title);
      if (blueprintWindowAuditService.shouldAuditChannel(channelId, forceAudit)) {
        blueprintWindowAuditService.auditChannelConsistency(
          channelId,
          blueprintId,
          playlistIds,
          segments,
          runtime.currentIndex,
          timelineIndex,
          horizon
        );
      }
    }

    return {
      channelId,
      blueprintId,
      now: cursor.now,
      current: cursor.current,
      engine: cursor.engine,
      visible: cursor.visible,
      timing: cursor.timing,
      timelineIndex,
      timelineSegment,
      timelineMatchMethod,
      scheduleAnchorMs: cursor.scheduleAnchorMs,
      cursorSource: cursor.cursorSource,
      activePlaybackTimeSec: cursor.activePlaybackTimeSec,
      activeFfmpegTimeSec: cursor.activeFfmpegTimeSec,
      playbackEpoch: cursor.playbackEpoch,
      inSync,
      mismatch,
    };
  }

  async verifyObservers(
    blueprintId: string,
    channelId: string,
    horizon: SimulationResult['horizon'] = '24h'
  ): Promise<{
    ok: boolean;
    mismatches: Array<{ observer: string; media: string | null; index?: number | null }>;
    ffmpegMedia: string | null;
    liveCursorMedia: string | null;
    nowPlayingMedia: string | null;
    timelineMedia: string | null;
    cursorSource: string;
  }> {
    const cursor = await this.getLiveCursor(blueprintId, channelId, undefined, horizon);
    const nowPlaying = await blueprintPlaybackService.getDiagnostics(channelId);

    const ffmpegMedia = cursor.current?.title ?? cursor.engine?.title ?? null;
    const liveCursorMedia = ffmpegMedia;
    const nowPlayingMedia = nowPlaying?.currentAsset ?? null;
    const timelineMedia = cursor.timelineSegment?.title ?? null;

    const mismatches: Array<{ observer: string; media: string | null; index?: number | null }> = [];
    const reference = ffmpegMedia;

    if (reference) {
      if (nowPlayingMedia && nowPlayingMedia !== reference) {
        mismatches.push({ observer: 'now_playing', media: nowPlayingMedia });
      }
      if (timelineMedia && timelineMedia !== reference) {
        mismatches.push({ observer: 'timeline', media: timelineMedia, index: cursor.timelineIndex });
      }
    }

    if (mismatches.length) {
      logger.warn(
        `[SYNC_FAILURE] channelId=${channelId} ffmpeg=${ffmpegMedia} ` +
          mismatches.map((m) => `${m.observer}=${m.media}`).join(' ')
      );
    }

    return {
      ok: mismatches.length === 0,
      mismatches,
      ffmpegMedia,
      liveCursorMedia,
      nowPlayingMedia,
      timelineMedia,
      cursorSource: cursor.cursorSource ?? 'ffmpeg_live',
    };
  }

  async verifySync(
    blueprintId: string,
    channelId: string,
    horizon: SimulationResult['horizon'] = '24h'
  ): Promise<{
    runtimeMedia: string | null;
    timelineMedia: string | null;
    concatMedia: string | null;
    ffmpegMedia: string | null;
    match: boolean;
    playbackEpoch: number;
    runtimeWindowVersion: string;
    timelineVersion: string;
  }> {
    const cursor = await this.getLiveCursor(blueprintId, channelId, undefined, horizon);
    const rt = blueprintPlaybackService.getRuntime(channelId);
    const idx = rt?.currentIndex ?? 0;

    const runtimeMedia = rt?.segments[idx]?.title ?? cursor.current?.title ?? null;
    const timelineMedia = cursor.timelineSegment?.title ?? null;
    const ffmpegMedia = cursor.current?.title ?? null;

    const concatPath = blueprintPlaybackService.getBlueprintConcatPath(channelId);
    let concatMedia: string | null = null;
    try {
      if (fs.existsSync(concatPath)) {
        const lines = fs
          .readFileSync(concatPath, 'utf8')
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.startsWith('file '));
        const line = lines[idx];
        if (line) {
          const m = line.match(/^file\s+'(.+)'$/);
          concatMedia = m ? path.basename(m[1]) : line;
        }
      }
    } catch {
      concatMedia = null;
    }

    const labels = [runtimeMedia, timelineMedia, concatMedia, ffmpegMedia].filter(Boolean);
    const unique = new Set(labels);
    const match = labels.length > 0 && unique.size === 1;

    if (!match) {
      logger.warn(
        `[VERIFY_SYNC] channelId=${channelId} blueprintId=${blueprintId} match=false ` +
          `runtimeMedia=${runtimeMedia ?? 'none'} timelineMedia=${timelineMedia ?? 'none'} ` +
          `concatMedia=${concatMedia ?? 'none'} ffmpegMedia=${ffmpegMedia ?? 'none'}`
      );
    }

    return {
      runtimeMedia,
      timelineMedia,
      concatMedia,
      ffmpegMedia,
      match,
      playbackEpoch: cursor.playbackEpoch ?? blueprintPlaybackService.getPlaybackEpoch(channelId),
      runtimeWindowVersion: blueprintWindowAuditService.runtimeWindowVersion(channelId),
      timelineVersion: blueprintWindowAuditService.timelineVersion(blueprintId, horizon),
    };
  }

  async simulate(id: string, horizon: SimulationResult['horizon'] = '1h'): Promise<SimulationResult> {
    const row = await this.getById(id);
    const blocks = this.parseBlocks(row.blocks);
    const playlists = await this.loadPlaylistSources(this.extractPlaylistIds(blocks));
    const channelId = row.channel?.id;
    return this.generateTimeline(blocks, playlists, horizon, id, channelId);
  }

  async simulateBlocks(
    blocks: unknown,
    horizon: SimulationResult['horizon'] = '24h',
    blueprintId?: string,
    channelId?: string,
    debug = false
  ): Promise<SimulationResult> {
    const parsed = this.parseBlocks(blocks);
    const playlists = await this.loadPlaylistSources(this.extractPlaylistIds(parsed));
    return this.generateTimeline(parsed, playlists, horizon, blueprintId, channelId, debug);
  }

  /** One source of truth for Watch Blueprint — aligned with live engine when channel is linked. */
  async generateTimeline(
    blocks: BlueprintBlock[],
    playlists: Map<string, PlaylistContentSource>,
    horizon: SimulationResult['horizon'],
    blueprintId?: string,
    channelId?: string,
    debug = false
  ): Promise<SimulationResult> {
    let startTime = new Date();
    let seed = startTime.getTime();
    let syncedWithChannel = false;
    let effectiveHorizon = horizon;

    if (channelId && blueprintId) {
      const ctx = blueprintPlaybackService.getExecutionContext(channelId, blueprintId);
      if (ctx && ctx.blueprintId === blueprintId) {
        startTime = ctx.startTime;
        seed = ctx.seed;
        syncedWithChannel = ctx.hasLiveState;
        effectiveHorizon = this.pickLiveTimelineHorizon(
          horizon,
          ctx.startTime.getTime(),
          ctx.scheduleCursorMs
        );
        if (effectiveHorizon !== horizon) {
          logger.info(
            `[TIMELINE_REGEN] blueprintId=${blueprintId} channelId=${channelId} ` +
              `horizonEscalated=${horizon}->${effectiveHorizon} ` +
              `scheduleSpanMs=${ctx.scheduleCursorMs - ctx.startTime.getTime()}`
          );
        }
      }
    }

    let raw = blueprintExecutionService.simulateHorizon({
      blocks,
      playlists,
      horizon: effectiveHorizon,
      startTime,
      seed,
      source: 'TIMELINE',
      debug,
    });

    let timelineMergeApplied = false;
    let pinnedSegmentOffset = 0;
    if (channelId && blueprintId && syncedWithChannel) {
      const mergeCtx = blueprintPlaybackService.getTimelineMergeContext(channelId);
      if (mergeCtx && mergeCtx.pinnedSegments.length > 0) {
        const windowStartMs = new Date(mergeCtx.pinnedSegments[0].startsAt).getTime();
        const anchorMs = startTime.getTime();
        let prefixSegments: ResolvedSegment[] = [];

        if (windowStartMs > anchorMs + 1000) {
          const prefixRun = blueprintExecutionService.execute({
            blocks,
            playlists,
            count: 500,
            startTime,
            initialState: undefined,
            seed: mergeCtx.seed,
            source: 'TIMELINE',
          });
          prefixSegments = prefixRun.segments.filter(
            (s) => new Date(s.endsAt).getTime() <= windowStartMs
          );
        }

        const futureHorizon = this.pickLiveTimelineHorizon(
          effectiveHorizon,
          mergeCtx.futureStartTime.getTime(),
          mergeCtx.scheduleCursorMs
        );

        const futureSim = blueprintExecutionService.simulateHorizon({
          blocks,
          playlists,
          horizon: futureHorizon,
          startTime: mergeCtx.futureStartTime,
          initialState: mergeCtx.futureInitialState,
          seed: mergeCtx.seed,
          source: 'TIMELINE',
          debug,
        });

        pinnedSegmentOffset = prefixSegments.length;
        raw = {
          ...futureSim,
          horizon: effectiveHorizon,
          segments: [...prefixSegments, ...mergeCtx.pinnedSegments, ...futureSim.segments],
        };
        timelineMergeApplied = true;

        logger.info(
          `[TIMELINE_MERGE] blueprintId=${blueprintId} channelId=${channelId} ` +
            `pinned=${mergeCtx.pinnedSegments.length} prefix=${prefixSegments.length} ` +
            `future=${futureSim.segments.length} pendingChanges=${mergeCtx.pendingPlaylistChanges} ` +
            `futureStart=${mergeCtx.futureStartTime.toISOString()}`
        );
      }
    }

    let liveSegmentIndex: number | null = null;
    if (channelId && blueprintId) {
      const runtime = blueprintPlaybackService.getRuntime(channelId);
      const windowSeg = runtime?.segments[runtime.currentIndex];
      const runtimeEpoch = runtime?.playbackEpoch ?? blueprintPlaybackService.getPlaybackEpoch(channelId);

      if (windowSeg) {
        if (timelineMergeApplied && runtime) {
          liveSegmentIndex = pinnedSegmentOffset + runtime.currentIndex;
        } else {
        let match = this.resolveTimelineByPlaybackSegment(
          raw.segments,
          windowSeg,
          channelId,
          runtime?.currentIndex ?? 0,
          { playbackEpoch: runtimeEpoch, timelinePlaybackEpoch: runtimeEpoch }
        );

        if (
          !match.matchFound &&
          effectiveHorizon !== '7d' &&
          match.failureReason?.includes('beyond_timeline')
        ) {
          logger.info(
            `[TIMELINE_REGEN] blueprintId=${blueprintId} channelId=${channelId} ` +
              `retryHorizon=7d reason=${match.failureReason}`
          );
          raw = blueprintExecutionService.simulateHorizon({
            blocks,
            playlists,
            horizon: '7d',
            startTime,
            seed,
            source: 'TIMELINE',
            debug,
          });
          effectiveHorizon = '7d';
          match = this.resolveTimelineByPlaybackSegment(
            raw.segments,
            windowSeg,
            channelId,
            runtime?.currentIndex ?? 0,
            { playbackEpoch: runtimeEpoch, timelinePlaybackEpoch: runtimeEpoch }
          );
        }
        liveSegmentIndex = match.index;
        }
      } else {
        const cursor = await this.getLiveCursor(blueprintId, channelId, raw.segments, effectiveHorizon);
        liveSegmentIndex = cursor.timelineIndex;
      }
    }

    const enriched = blueprintAnalyticsService.enrichSimulation(raw, blocks, playlists);
    const result: SimulationResult = {
      ...enriched,
      liveSegmentIndex,
      syncedWithChannel,
      scheduleAnchor: startTime.toISOString(),
      generatedAt: new Date().toISOString(),
    };

    if (blueprintId) {
      const row = await prisma.channelBlueprint.findUnique({
        where: { id: blueprintId },
        select: { updatedAt: true },
      });
      if (row) {
        result.blueprintUpdatedAt = row.updatedAt.toISOString();
        const playbackEpoch =
          channelId ? blueprintPlaybackService.getPlaybackEpoch(channelId) : 0;
        result.playbackEpoch = playbackEpoch;
        this.saveTimelineCache(
          blueprintId,
          horizon,
          result,
          result.blueprintUpdatedAt,
          playbackEpoch
        );
        if (channelId) {
          const blocksParsed = blocks;
          blueprintWindowAuditService.logBlueprintState({
            channelId,
            blueprintId,
            playlistIds: this.extractPlaylistIds(blocksParsed),
            horizon: effectiveHorizon,
          });
          logger.info(
            `[TIMELINE_REGEN] blueprintId=${blueprintId} channelId=${channelId} ` +
              `timelineSource=generateTimeline horizon=${effectiveHorizon} ` +
              `timelineVersion=${blueprintWindowAuditService.timelineVersion(blueprintId, effectiveHorizon)}`
          );
        }
      }
    }

    return result;
  }

  async getCachedTimeline(
    blueprintId: string,
    horizon: SimulationResult['horizon'],
    channelId?: string
  ): Promise<SimulationResult | null> {
    const row = await prisma.channelBlueprint.findUnique({
      where: { id: blueprintId },
      select: { updatedAt: true },
    });
    if (!row) return null;
    const playbackEpoch = channelId
      ? blueprintPlaybackService.getPlaybackEpoch(channelId)
      : undefined;
    return this.loadTimelineCache(
      blueprintId,
      horizon,
      row.updatedAt.toISOString(),
      playbackEpoch
    );
  }

  async verifyTimelineExecution(
    blocks: BlueprintBlock[],
    segmentCount = 48,
    channelId?: string,
    blueprintId?: string
  ) {
    const playlists = await this.loadPlaylistSources(this.extractPlaylistIds(blocks));
    let startTime = new Date();
    let seed = startTime.getTime();
    if (channelId && blueprintId) {
      const ctx = blueprintPlaybackService.getExecutionContext(channelId, blueprintId);
      if (ctx) {
        startTime = ctx.startTime;
        seed = ctx.seed;
      }
    }
    return blueprintExecutionService.verifyDeterminism(blocks, playlists, segmentCount, startTime, undefined, seed);
  }

  async verifyExecutionConsistency(
    blocks: BlueprintBlock[],
    channelId?: string,
    blueprintId?: string,
    segmentCounts: number[] = [48, 96, 500]
  ) {
    const playlists = await this.loadPlaylistSources(this.extractPlaylistIds(blocks));
    let startTime = new Date();
    let seed = startTime.getTime();
    if (channelId && blueprintId) {
      const ctx = blueprintPlaybackService.getExecutionContext(channelId, blueprintId);
      if (ctx) {
        startTime = ctx.startTime;
        seed = ctx.seed;
      }
    }
    return blueprintExecutionService.verifyExecutionConsistency(
      blocks,
      playlists,
      segmentCounts,
      startTime,
      undefined,
      seed
    );
  }

  async previewNext(id: string, count = 12) {
    const row = await this.getById(id);
    const blocks = this.parseBlocks(row.blocks);
    const playlists = await this.loadPlaylistSources(this.extractPlaylistIds(blocks));
    const { segments, warnings } = blueprintExecutionService.execute({
      blocks,
      playlists,
      count,
      source: 'ENGINE',
    });
    return { segments, warnings };
  }

  /** Publish blueprint to a playlist channel and activate blueprint playback. */
  async publishToChannel(
    blueprintId: string,
    channelId: string,
    blocksOverride?: BlueprintBlock[]
  ): Promise<PublishBlueprintResult> {
    if (blocksOverride?.length) {
      await this.update(blueprintId, { blocks: blocksOverride });
    }

    const blueprint = await this.getById(blueprintId);
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new AppError('Channel not found', 404);
    if (!channel.isPlaylistChannel) {
      throw new AppError('Blueprint channels require a playlist-type channel', 400);
    }

    const blocks = this.parseBlocks(blueprint.blocks);
    const playlists = await this.loadPlaylistSources(this.extractPlaylistIds(blocks));
    const analysis = blueprintEngineService.analyzeBlueprint(blocks, playlists);
    const critical = analysis.filter((w) => w.severity === 'critical');
    if (critical.length > 0) {
      throw new AppError(
        `Cannot publish: ${critical.map((w) => w.message).join('; ')}`,
        400
      );
    }

    const { ffmpegService } = await import('./ffmpeg.service');
    const procRunning = !!ffmpegService.getProcessInfo(channelId);
    const wasRunning =
      procRunning ||
      channel.status === 'ONLINE' ||
      channel.status === 'STARTING' ||
      channel.status === 'ERROR';

    await prisma.$transaction(async (tx) => {
      const otherHolder = await tx.channel.findFirst({ where: { blueprintId } });
      if (otherHolder && otherHolder.id !== channelId) {
        await tx.channel.update({
          where: { id: otherHolder.id },
          data: { blueprintId: null, useBlueprint: false },
        });
      }

      if (channel.blueprintId && channel.blueprintId !== blueprintId) {
        await tx.channel.update({
          where: { id: channelId },
          data: { blueprintId: null, useBlueprint: false },
        });
      }

      await tx.channelBlueprint.update({
        where: { id: blueprintId },
        data: { status: 'PUBLISHED' },
      });

      await tx.channel.update({
        where: { id: channelId },
        data: { blueprintId, useBlueprint: true },
      });
    });

    const { blueprintPlaybackService } = await import('./blueprintPlayback.service');
    const concatPath = await blueprintPlaybackService.refreshChannelWindow(channelId);
    this.invalidateTimelineCaches(blueprintId, 'BLUEPRINT_REPUBLISH');

    if (!concatPath || !fs.existsSync(concatPath)) {
      throw new AppError(
        'Blueprint published but no playable content was generated. Assign playlists with READY videos to all blocks.',
        400
      );
    }

    const runtime = blueprintPlaybackService.getRuntime(channelId);
    const segmentCount = runtime?.segments.length ?? 0;
    if (segmentCount === 0) {
      throw new AppError('Blueprint window is empty — check block playlists have READY items.', 400);
    }

    let streamRestarted = false;
    const { monitorService } = await import('./monitor.service');
    monitorService.addLog(
      channelId,
      'INFO',
      `Blueprint "${blueprint.name}" published — ${segmentCount} segments, engine order active.`
    );

    if (wasRunning) {
      await ffmpegService.forceRestartChannel(channelId);
      streamRestarted = true;
    }

    const updatedChannel = await prisma.channel.findUnique({ where: { id: channelId } });

    return {
      blueprint: await this.getById(blueprintId),
      channel: {
        id: channelId,
        name: channel.name,
        status: updatedChannel?.status ?? channel.status,
      },
      playbackMode: 'BLUEPRINT',
      blueprintName: blueprint.name,
      status: streamRestarted ? 'Active' : 'Pending restart',
      streamRestarted,
      segmentCount,
      warnings: analysis.filter((w) => w.severity !== 'critical').map((w) => w.message),
    };
  }

  getTemplates() {
    return BLUEPRINT_TEMPLATES;
  }
}

export const blueprintService = new BlueprintService();
