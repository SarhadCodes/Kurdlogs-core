import fs from 'fs';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { blueprintPlaybackService } from './blueprintPlayback.service';
import { blueprintService } from './blueprint.service';
import { blueprintWindowAuditService } from './blueprintWindowAudit.service';

export type PlaylistMutationType = 'add' | 'delete' | 'replace' | 'reorder' | 'other';

export interface ChannelPlaylistRef {
  channelId: string;
  channelName: string;
  status: string;
  kind: 'playlist' | 'blueprint';
  blueprintId?: string;
  blueprintBlockIds?: string[];
}

export interface PlaylistMutationMeta {
  playlistId: string;
  changeType: PlaylistMutationType;
  oldMedia?: string | null;
  newMedia?: string | null;
  itemId?: string;
}

function isActivePlaybackStatus(status: string): boolean {
  return status === 'ONLINE' || status === 'STARTING';
}

function hasActiveConcat(channelId: string): boolean {
  const concatPath = blueprintPlaybackService.getBlueprintConcatPath(channelId);
  return fs.existsSync(concatPath) && fs.readFileSync(concatPath, 'utf8').trim().length > 0;
}

class BlueprintPlaylistSyncService {
  private readonly rebuildInFlight = new Map<string, Promise<{ ok: boolean; deferred: boolean }>>();

  /** Playlist channels + blueprint channels referencing playlist via block config. */
  async findChannelsUsingPlaylist(playlistId: string): Promise<ChannelPlaylistRef[]> {
    const results: ChannelPlaylistRef[] = [];
    const seen = new Set<string>();

    const playlistChannels = await prisma.channel.findMany({
      where: { playlistId, isPlaylistChannel: true },
      select: { id: true, name: true, status: true },
    });
    for (const ch of playlistChannels) {
      seen.add(ch.id);
      results.push({
        channelId: ch.id,
        channelName: ch.name,
        status: ch.status,
        kind: 'playlist',
      });
    }

    const blueprintChannels = await prisma.channel.findMany({
      where: { useBlueprint: true, blueprintId: { not: null } },
      include: { blueprint: { select: { id: true, blocks: true } } },
    });

    for (const ch of blueprintChannels) {
      if (seen.has(ch.id)) continue;
      if (!ch.blueprint?.blocks) continue;
      const blocks = ch.blueprint.blocks as Array<{ id: string; config?: { playlistId?: string } }>;
      const matching = blocks.filter((b) => b.config?.playlistId === playlistId);
      if (matching.length === 0) continue;
      results.push({
        channelId: ch.id,
        channelName: ch.name,
        status: ch.status,
        kind: 'blueprint',
        blueprintId: ch.blueprintId!,
        blueprintBlockIds: matching.map((b) => b.id),
      });
    }

    return results;
  }

  /**
   * Non-disruptive pipeline: defer live changes, apply on natural window roll.
   * Playlist mutations never restart FFmpeg.
   */
  async handlePlaylistMutation(meta: PlaylistMutationMeta): Promise<void> {
    const channels = await this.findChannelsUsingPlaylist(meta.playlistId);
    const playlistVer = await blueprintWindowAuditService.playlistVersion(meta.playlistId);

    logger.info(
      `[PLAYLIST_MUTATION] playlistId=${meta.playlistId} changeType=${meta.changeType} ` +
        `oldMedia=${meta.oldMedia ?? 'n/a'} newMedia=${meta.newMedia ?? 'n/a'} ` +
        `itemId=${meta.itemId ?? 'n/a'} playlistVersion=${playlistVer} ` +
        `affectedChannels=${channels.length} deferred=pending`
    );

    for (const ch of channels) {
      if (!isActivePlaybackStatus(ch.status) && ch.status !== 'OFFLINE') continue;

      if (ch.kind === 'blueprint' && ch.blueprintId) {
        const result = await this.rebuildBlueprintChannel(ch.channelId, ch.blueprintId, meta);
        logger.info(
          `[PLAYLIST_MUTATION] channelId=${ch.channelId} blueprintId=${ch.blueprintId} ` +
            `changeType=${meta.changeType} deferred=${result.deferred} ` +
            `ffmpegRestart=false windowRebuilt=${result.ok}`
        );
      } else if (ch.kind === 'playlist' && isActivePlaybackStatus(ch.status)) {
        logger.info(
          `[PLAYLIST_MUTATION] channelId=${ch.channelId} kind=playlist changeType=${meta.changeType} ` +
            `deferred=true ffmpegRestart=false note=concat_on_disk_updated_ffmpeg_unchanged`
        );
      }
    }
  }

  async rebuildBlueprintChannel(
    channelId: string,
    blueprintId: string,
    meta?: PlaylistMutationMeta,
    windowReason: import('./blueprintPlayback.service').WindowRefreshReason = 'playlist_mutation'
  ): Promise<{ ok: boolean; deferred: boolean }> {
    const existing = this.rebuildInFlight.get(channelId);
    if (existing) return existing;

    const job = this.runBlueprintRebuild(channelId, blueprintId, meta, windowReason);
    this.rebuildInFlight.set(channelId, job);
    try {
      return await job;
    } finally {
      if (this.rebuildInFlight.get(channelId) === job) {
        this.rebuildInFlight.delete(channelId);
      }
    }
  }

  private async runBlueprintRebuild(
    channelId: string,
    blueprintId: string,
    meta?: PlaylistMutationMeta,
    windowReason: import('./blueprintPlayback.service').WindowRefreshReason = 'playlist_mutation'
  ): Promise<{ ok: boolean; deferred: boolean }> {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { status: true },
    });

    const liveWithConcat =
      !!channel && isActivePlaybackStatus(channel.status) && hasActiveConcat(channelId);

    if (liveWithConcat) {
      await blueprintPlaybackService.ensureRuntime(channelId);
      blueprintPlaybackService.syncPlaybackFromFfmpeg(channelId);
      const rt = blueprintPlaybackService.getRuntime(channelId);

      logger.info(
        `[PLAYLIST_SYNC] channelId=${channelId} blueprintId=${blueprintId} phase=defer ` +
          `changeType=${meta?.changeType ?? 'manual'} currentIndex=${rt?.currentIndex ?? 0} ` +
          `ffmpegRestart=false`
      );

      const futureBuild = await blueprintPlaybackService.previewFuturePlaylistState(channelId);
      if (!futureBuild) {
        logger.error(`[PLAYLIST_SYNC] channelId=${channelId} future state preview failed`);
        return { ok: false, deferred: true };
      }

      blueprintPlaybackService.applyDeferredPlaylistState(
        channelId,
        futureBuild,
        meta?.changeType
      );

      blueprintService.invalidateTimelineCaches(blueprintId, 'PLAYLIST_MUTATION');
      await blueprintService.regenerateTimelineCacheForChannel(blueprintId, channelId);

      const epoch = blueprintPlaybackService.getPlaybackEpoch(channelId);
      const { wsService } = await import('./websocket.service');
      wsService.emitBlueprintPlaybackSync(blueprintId, channelId, epoch);

      blueprintWindowAuditService.logBlueprintState({
        channelId,
        blueprintId,
        playlistIds: meta?.playlistId ? [meta.playlistId] : [],
      });

      return { ok: true, deferred: true };
    }

    logger.info(
      `[PLAYLIST_SYNC] channelId=${channelId} blueprintId=${blueprintId} phase=offline_prep ` +
        `changeType=${meta?.changeType ?? 'manual'} status=${channel?.status ?? 'unknown'} ffmpegRestart=false`
    );

    const newPath = await blueprintPlaybackService.refreshChannelWindow(channelId, {
      reason: windowReason,
    });
    if (!newPath) {
      logger.error(`[PLAYLIST_SYNC] channelId=${channelId} window refresh failed`);
      return { ok: false, deferred: false };
    }

    await blueprintService.regenerateTimelineCacheForChannel(blueprintId, channelId);

    const epoch = blueprintPlaybackService.getPlaybackEpoch(channelId);
    const { wsService } = await import('./websocket.service');
    wsService.emitBlueprintPlaybackSync(blueprintId, channelId, epoch);

    blueprintWindowAuditService.logBlueprintState({
      channelId,
      blueprintId,
      playlistIds: meta?.playlistId ? [meta.playlistId] : [],
    });

    return { ok: true, deferred: false };
  }
}

export const blueprintPlaylistSyncService = new BlueprintPlaylistSyncService();
