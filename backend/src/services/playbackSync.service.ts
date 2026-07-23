/**
 * Periodic sync health — compares FFmpeg-derived media across observers.
 */
import { logger } from '../utils/logger';
import { blueprintPlaybackService } from './blueprintPlayback.service';

const SYNC_INTERVAL_MS = 5000;

interface ChannelSyncMonitor {
  blueprintId: string;
  interval: ReturnType<typeof setInterval>;
}

class PlaybackSyncService {
  private readonly monitors = new Map<string, ChannelSyncMonitor>();

  startMonitoring(channelId: string, blueprintId: string): void {
    this.stopMonitoring(channelId);
    const interval = setInterval(() => {
      void this.runHealthCheck(channelId, blueprintId);
    }, SYNC_INTERVAL_MS);
    this.monitors.set(channelId, { blueprintId, interval });
  }

  stopMonitoring(channelId: string): void {
    const m = this.monitors.get(channelId);
    if (m) clearInterval(m.interval);
    this.monitors.delete(channelId);
  }

  private async runHealthCheck(channelId: string, blueprintId: string): Promise<void> {
    const rt = blueprintPlaybackService.syncPlaybackFromFfmpeg(channelId);
    if (!rt?.segments.length) return;

    const ffmpegMedia = rt.segments[rt.currentIndex]?.title ?? null;
    const diag = await blueprintPlaybackService.getDiagnostics(channelId);
    const nowPlayingMedia = diag?.currentAsset ?? null;

    let timelineMedia: string | null = null;
    try {
      const { blueprintService } = await import('./blueprint.service');
      const cursor = await blueprintService.getLiveCursor(blueprintId, channelId, undefined, '24h');
      timelineMedia = cursor.timelineSegment?.title ?? cursor.current?.title ?? null;
    } catch {
      /* channel offline */
    }

    const mismatches: string[] = [];
    if (ffmpegMedia && nowPlayingMedia && ffmpegMedia !== nowPlayingMedia) {
      mismatches.push(`nowPlaying=${nowPlayingMedia}`);
    }
    if (ffmpegMedia && timelineMedia && ffmpegMedia !== timelineMedia) {
      mismatches.push(`timeline=${timelineMedia}`);
    }

    if (mismatches.length) {
      logger.warn(
        `[SYNC_FAILURE] channelId=${channelId} ffmpegMedia=${ffmpegMedia} ` +
          `timelineMedia=${timelineMedia ?? 'n/a'} nowPlayingMedia=${nowPlayingMedia ?? 'n/a'} ` +
          `activePlaybackTimeSec=${rt.activePlaybackTimeSec.toFixed(2)} currentIndex=${rt.currentIndex} ` +
          `mismatches=${mismatches.join(',')}`
      );
    }
  }
}

export const playbackSyncService = new PlaybackSyncService();
