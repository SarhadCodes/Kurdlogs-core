import fs from 'fs';
import path from 'path';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { blueprintPlaybackService } from './blueprintPlayback.service';
import type { ResolvedSegment } from '../types/blueprint.types';

function readConcatMediaList(filePath: string): string[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('file '))
      .map((l) => {
        const m = l.match(/^file\s+'(.+)'$/);
        return m ? path.basename(m[1]) : l;
      });
  } catch {
    return [];
  }
}

function segmentMediaLabel(seg: ResolvedSegment | undefined): string {
  if (!seg) return 'none';
  return seg.title || seg.itemId || 'unknown';
}

class BlueprintWindowAuditService {
  private readonly lastChannelAudit = new Map<string, number>();
  private readonly auditIntervalMs = 60_000;

  shouldAuditChannel(channelId: string, force: boolean): boolean {
    if (force) return true;
    const now = Date.now();
    const last = this.lastChannelAudit.get(channelId) ?? 0;
    if (now - last < this.auditIntervalMs) return false;
    this.lastChannelAudit.set(channelId, now);
    return true;
  }
  async findLiveBlueprintChannelsForPlaylist(playlistId: string): Promise<
    Array<{ channelId: string; channelName: string; blueprintId: string; status: string }>
  > {
    const channels = await prisma.channel.findMany({
      where: {
        useBlueprint: true,
        blueprintId: { not: null },
        status: { in: ['ONLINE', 'STARTING', 'ERROR'] },
      },
      include: { blueprint: { select: { id: true, blocks: true } } },
    });

    return channels
      .filter((ch) => {
        if (!ch.blueprint?.blocks) return false;
        const blocks = ch.blueprint.blocks as Array<{ config?: { playlistId?: string } }>;
        return blocks.some((b) => b.config?.playlistId === playlistId);
      })
      .map((ch) => ({
        channelId: ch.id,
        channelName: ch.name,
        blueprintId: ch.blueprintId!,
        status: ch.status,
      }));
  }

  /** Pre-FFmpeg validation — logs [WINDOW_AUDIT], [CONCAT_AUDIT]; returns failure reason when not startable. */
  validateBlueprintChannelStart(
    channelId: string,
    concatPath: string
  ): { ok: true } | { ok: false; reason: string } {
    const rt = blueprintPlaybackService.getRuntime(channelId);
    const persisted = blueprintPlaybackService.loadPersistedState(channelId);
    const segments = rt?.segments ?? [];
    const statePath = path.join(env.STREAMS_DIR, 'blueprints', `${channelId}.state.json`);
    const stateExists = fs.existsSync(statePath);

    let playableCount = 0;
    const invalidSegments: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i] as { videoPath?: string; title?: string };
      const vp = seg.videoPath;
      if (vp && fs.existsSync(vp)) {
        playableCount++;
      } else {
        invalidSegments.push(`idx=${i} title=${seg.title ?? 'none'} path=${vp ?? 'missing'}`);
      }
    }

    logger.info(
      `[WINDOW_AUDIT] channelId=${channelId} segmentCount=${segments.length} ` +
        `playableCount=${playableCount} invalidSegments=${invalidSegments.length > 0 ? invalidSegments.join(';') : 'none'}`
    );

    const entries: string[] = [];
    const missingFiles: string[] = [];
    const emptyEntries: number[] = [];
    if (fs.existsSync(concatPath)) {
      const lines = fs
        .readFileSync(concatPath, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('file '));
      lines.forEach((line, i) => {
        const m = line.match(/^file\s+'(.+)'$/);
        const filePath = m ? m[1] : '';
        entries.push(filePath ? path.basename(filePath) : line);
        if (!filePath) {
          emptyEntries.push(i);
        } else if (!fs.existsSync(filePath)) {
          missingFiles.push(filePath);
        }
      });
    }

    logger.info(
      `[CONCAT_AUDIT] channelId=${channelId} concatPath=${concatPath} entries=${entries.length} ` +
        `missingFiles=${missingFiles.length > 0 ? missingFiles.map((f) => path.basename(f)).join(',') : 'none'} ` +
        `emptyEntries=${emptyEntries.length > 0 ? emptyEntries.join(',') : 'none'}`
    );

    if (segments.length === 0) {
      return {
        ok: false,
        reason: `runtime.segments empty (stateExists=${stateExists} persistedSegments=${persisted?.windowSegments?.length ?? 0})`,
      };
    }
    if (entries.length === 0) {
      return { ok: false, reason: 'concat file has no file entries' };
    }
    if (playableCount === 0) {
      return { ok: false, reason: 'no playable runtime segments — all video paths missing' };
    }
    if (missingFiles.length > 0) {
      return {
        ok: false,
        reason: `concat references ${missingFiles.length} missing file(s): ${missingFiles.map((f) => path.basename(f)).join(', ')}`,
      };
    }
    if (emptyEntries.length > 0) {
      return { ok: false, reason: `concat has ${emptyEntries.length} empty file entry line(s)` };
    }
    return { ok: true };
  }

  logChannelStart(channelId: string, concatPath: string, ffmpegCommand: string): void {
    const rt = blueprintPlaybackService.getRuntime(channelId);
    const statePath = path.join(env.STREAMS_DIR, 'blueprints', `${channelId}.state.json`);
    const concatEntryCount = fs.existsSync(concatPath)
      ? fs
          .readFileSync(concatPath, 'utf8')
          .split('\n')
          .filter((l) => l.trim().startsWith('file ')).length
      : 0;

    logger.info(
      `[CHANNEL_START] channelId=${channelId} runtimeSegmentCount=${rt?.segments.length ?? 0} ` +
        `concatEntryCount=${concatEntryCount} stateExists=${fs.existsSync(statePath)} ` +
        `ffmpegCommand=${ffmpegCommand}`
    );
  }

  logChannelStartFailure(
    channelId: string,
    reason: string,
    ffmpegExitCode?: number | null,
    stderr?: string
  ): void {
    logger.error(
      `[CHANNEL_START_FAILURE] channelId=${channelId} reason=${reason} ` +
        `ffmpegExitCode=${ffmpegExitCode ?? 'n/a'} stderr=${stderr ? stderr.slice(0, 500) : 'n/a'}`
    );
  }

  async playlistVersion(playlistId: string): Promise<string> {
    const pl = await prisma.playlist.findUnique({
      where: { id: playlistId },
      include: {
        items: { orderBy: { position: 'asc' }, select: { id: true, originalFilename: true } },
      },
    });
    if (!pl) return `missing:${playlistId}`;
    const itemSig = pl.items.map((i) => i.id).join(',');
    return `${pl.id}@${pl.updatedAt.toISOString()} items=${pl.items.length} sig=${itemSig.slice(0, 64)}`;
  }

  async blueprintVersion(blueprintId: string): Promise<string> {
    const row = await prisma.channelBlueprint.findUnique({
      where: { id: blueprintId },
      select: { updatedAt: true },
    });
    return row ? `${blueprintId}@${row.updatedAt.toISOString()}` : `missing:${blueprintId}`;
  }

  runtimeWindowVersion(channelId: string): string {
    const rt = blueprintPlaybackService.getRuntime(channelId);
    const persisted = blueprintPlaybackService.loadPersistedState(channelId);
    const epoch = rt?.playbackEpoch ?? persisted?.playbackEpoch ?? 0;
    const windows = persisted?.windowsEmitted ?? 0;
    const updated = persisted?.updatedAt ?? 'none';
    const segCount = rt?.segments.length ?? persisted?.windowSegments?.length ?? 0;
    return `epoch=${epoch} windows=${windows} segments=${segCount} stateAt=${updated}`;
  }

  timelineVersion(blueprintId: string, horizon: '1h' | '24h' | '7d' = '24h'): string {
    try {
      const file = path.join(env.STREAMS_DIR, 'blueprints', 'cache', `${blueprintId}-${horizon}.json`);
      if (!fs.existsSync(file)) return 'cache=missing';
      const cached = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        playbackEpoch?: number;
        savedAt?: string;
        data?: { generatedAt?: string; playbackEpoch?: number };
      };
      const epoch = cached.playbackEpoch ?? cached.data?.playbackEpoch ?? 0;
      const generatedAt = cached.data?.generatedAt ?? cached.savedAt ?? 'unknown';
      return `epoch=${epoch} generatedAt=${generatedAt}`;
    } catch {
      return 'cache=unreadable';
    }
  }

  logBlueprintState(params: {
    channelId: string;
    blueprintId: string;
    playlistIds: string[];
    horizon?: '1h' | '24h' | '7d';
  }): void {
    void (async () => {
      const playlistVersions = await Promise.all(
        params.playlistIds.map((id) => this.playlistVersion(id))
      );
      const bpVer = await this.blueprintVersion(params.blueprintId);
      logger.info(
        `[BLUEPRINT_STATE] channelId=${params.channelId} blueprintId=${params.blueprintId} ` +
          `playlistVersion=${playlistVersions.join('|') || 'none'} ` +
          `blueprintVersion=${bpVer} ` +
          `runtimeWindowVersion=${this.runtimeWindowVersion(params.channelId)} ` +
          `timelineVersion=${this.timelineVersion(params.blueprintId, params.horizon ?? '24h')}`
      );
    })();
  }

  logWindowContent(
    channelId: string,
    segmentIndex: number,
    source: 'runtime_window' | 'concat_file' | 'state_json' = 'runtime_window'
  ): void {
    const rt = blueprintPlaybackService.getRuntime(channelId);
    const persisted = blueprintPlaybackService.loadPersistedState(channelId);
    const segments = rt?.segments ?? (persisted?.windowSegments as ResolvedSegment[] | undefined);

    if (source === 'concat_file') {
      const concatPath = blueprintPlaybackService.getBlueprintConcatPath(channelId);
      const files = readConcatMediaList(concatPath);
      const media = files[segmentIndex] ?? 'none';
      logger.info(
        `[WINDOW_CONTENT] channelId=${channelId} segmentIndex=${segmentIndex} media=${media} ` +
          `source=concat_file concatPath=${concatPath} concatEntries=${files.length}`
      );
      return;
    }

    if (source === 'state_json') {
      const seg = persisted?.windowSegments?.[segmentIndex] as ResolvedSegment | undefined;
      logger.info(
        `[WINDOW_CONTENT] channelId=${channelId} segmentIndex=${segmentIndex} ` +
          `media=${segmentMediaLabel(seg)} itemId=${seg?.itemId ?? 'none'} ` +
          `occurrenceIndex=${seg?.occurrenceIndex ?? 'missing'} source=state_json`
      );
      return;
    }

    const seg = segments?.[segmentIndex];
    logger.info(
      `[WINDOW_CONTENT] channelId=${channelId} segmentIndex=${segmentIndex} ` +
        `media=${segmentMediaLabel(seg)} itemId=${seg?.itemId ?? 'none'} ` +
        `occurrenceIndex=${seg?.occurrenceIndex ?? 'missing'} source=runtime_window`
    );
  }

  logTimelineContent(
    channelId: string,
    blueprintId: string,
    timelineSegments: ResolvedSegment[],
    segmentIndex: number | null
  ): void {
    if (segmentIndex == null || segmentIndex < 0) {
      logger.info(
        `[TIMELINE_CONTENT] channelId=${channelId} blueprintId=${blueprintId} ` +
          `segmentIndex=none media=none source=timeline timelineLength=${timelineSegments.length}`
      );
      return;
    }
    const seg = timelineSegments[segmentIndex];
    logger.info(
      `[TIMELINE_CONTENT] channelId=${channelId} blueprintId=${blueprintId} ` +
        `segmentIndex=${segmentIndex} media=${segmentMediaLabel(seg)} itemId=${seg?.itemId ?? 'none'} ` +
        `occurrenceIndex=${seg?.occurrenceIndex ?? 'missing'} source=timeline ` +
        `timelineLength=${timelineSegments.length}`
    );
  }

  logWindowTimelineDiff(params: {
    channelId: string;
    blueprintId: string;
    runtimeSegments: ResolvedSegment[];
    timelineSegments: ResolvedSegment[];
    runtimeIndex: number;
    timelineIndex: number | null;
  }): void {
    const { runtimeSegments, timelineSegments, runtimeIndex, timelineIndex } = params;
    const runtimeMedia = segmentMediaLabel(runtimeSegments[runtimeIndex]);
    const timelineMedia =
      timelineIndex != null && timelineIndex >= 0
        ? segmentMediaLabel(timelineSegments[timelineIndex])
        : 'none';

    let firstMismatchIndex: number | null = null;
    const compareLen = Math.min(runtimeSegments.length, timelineSegments.length);
    for (let i = 0; i < compareLen; i++) {
      const r = runtimeSegments[i];
      const t = timelineSegments[i];
      if (
        r.blockId !== t.blockId ||
        r.itemId !== t.itemId ||
        r.occurrenceIndex !== t.occurrenceIndex
      ) {
        firstMismatchIndex = i;
        break;
      }
    }
    if (firstMismatchIndex == null && runtimeSegments.length !== timelineSegments.length) {
      firstMismatchIndex = compareLen;
    }

    const concatPath = blueprintPlaybackService.getBlueprintConcatPath(params.channelId);
    const concatFiles = readConcatMediaList(concatPath);
    const concatMatchesRuntime =
      runtimeSegments.length === concatFiles.length &&
      runtimeSegments.every((s, i) => {
        const vp = (s as { videoPath?: string }).videoPath;
        return vp ? path.basename(vp) === concatFiles[i] : false;
      });

    logger.info(
      `[WINDOW_TIMELINE_DIFF] channelId=${params.channelId} blueprintId=${params.blueprintId} ` +
        `runtimeMedia=${runtimeMedia} timelineMedia=${timelineMedia} ` +
        `runtimeIndex=${runtimeIndex} timelineIndex=${timelineIndex ?? 'none'} ` +
        `firstMismatchIndex=${firstMismatchIndex ?? 'none'} ` +
        `runtimeLen=${runtimeSegments.length} timelineLen=${timelineSegments.length} ` +
        `concatLen=${concatFiles.length} concatMatchesRuntime=${concatMatchesRuntime}`
    );
  }

  async logPlaylistMutation(params: {
    playlistId: string;
    changeType: 'add' | 'delete' | 'replace' | 'reorder' | 'other';
    oldMedia?: string | null;
    newMedia?: string | null;
    itemId?: string;
  }): Promise<void> {
    const affected = await this.findLiveBlueprintChannelsForPlaylist(params.playlistId);
    const playlistVer = await this.playlistVersion(params.playlistId);

    let windowRebuilt = false;
    let rebuildNote = 'no_live_blueprint_channels';

    if (affected.length > 0) {
      rebuildNote =
        'restartChannelsUsingPlaylist_queries_channel.playlistId_null_for_blueprint_channels';
      for (const ch of affected) {
        const before = this.runtimeWindowVersion(ch.channelId);
        const rt = blueprintPlaybackService.getRuntime(ch.channelId);
        if (rt) {
          rebuildNote = `runtime_unchanged channels=${affected.map((c) => c.channelId).join(',')}`;
        }
      }
    } else {
      rebuildNote = 'no_online_blueprint_channel_uses_playlist';
    }

    logger.info(
      `[PLAYLIST_MUTATION] playlistId=${params.playlistId} changeType=${params.changeType} ` +
        `oldMedia=${params.oldMedia ?? 'n/a'} newMedia=${params.newMedia ?? 'n/a'} ` +
        `itemId=${params.itemId ?? 'n/a'} playlistVersion=${playlistVer} ` +
        `windowRebuilt=${windowRebuilt} affectedBlueprintChannels=${affected.length} ` +
        `note=${rebuildNote}`
    );

    for (const ch of affected) {
      this.logBlueprintState({
        channelId: ch.channelId,
        blueprintId: ch.blueprintId,
        playlistIds: [params.playlistId],
      });
      this.logWindowContent(ch.channelId, 0, 'runtime_window');
      this.logWindowContent(ch.channelId, 0, 'concat_file');
    }
  }

  /** Full consistency snapshot for a live blueprint channel. */
  auditChannelConsistency(
    channelId: string,
    blueprintId: string,
    playlistIds: string[],
    timelineSegments: ResolvedSegment[],
    runtimeIndex: number,
    timelineIndex: number | null,
    horizon: '1h' | '24h' | '7d' = '24h'
  ): void {
    this.logBlueprintState({ channelId, blueprintId, playlistIds, horizon });

    const rt = blueprintPlaybackService.getRuntime(channelId);
    const runtimeSegments =
      rt?.segments ??
      (blueprintPlaybackService.loadPersistedState(channelId)?.windowSegments as
        | ResolvedSegment[]
        | undefined) ??
      [];

    this.logWindowContent(channelId, runtimeIndex, 'runtime_window');
    this.logWindowContent(channelId, runtimeIndex, 'concat_file');
    this.logWindowContent(channelId, runtimeIndex, 'state_json');
    this.logTimelineContent(channelId, blueprintId, timelineSegments, timelineIndex);

    if (runtimeSegments.length > 0) {
      this.logWindowTimelineDiff({
        channelId,
        blueprintId,
        runtimeSegments,
        timelineSegments,
        runtimeIndex,
        timelineIndex,
      });
    }
  }
}

export const blueprintWindowAuditService = new BlueprintWindowAuditService();
