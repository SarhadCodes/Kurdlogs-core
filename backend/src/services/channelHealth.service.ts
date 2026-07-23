import { prisma } from '../config/database';
import { ffmpegService } from './ffmpeg.service';
import { viewerService } from './viewer.service';
import { hasRecentHlsSegments } from '../utils/streamPaths';
import { blueprintPlaybackService } from './blueprintPlayback.service';

export type HealthLevel = 'EXCELLENT' | 'GOOD' | 'WARNING' | 'CRITICAL';

export interface PlaybackDiagnosticsReport {
  playbackSource: 'BLUEPRINT' | 'PLAYLIST' | 'MCR_BUS' | 'MCR_SWITCHER';
  blueprintName?: string | null;
  currentBlock?: string | null;
  currentPlaylist?: string | null;
  currentAsset?: string | null;
  nextBlock?: string | null;
  nextAsset?: string | null;
}

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
  playback?: PlaybackDiagnosticsReport;
}

function scoreChannel(input: {
  status: string;
  cpu: number;
  fps: number;
  speed: string;
  segmentsActive: boolean;
  procRunning: boolean;
}): { health: HealthLevel; healthScore: number } {
  let score = 100;

  if (input.status === 'ERROR') score -= 50;
  if (input.status === 'OFFLINE') score -= 30;
  if (!input.procRunning && input.status === 'ONLINE') score -= 40;
  if (!input.segmentsActive && input.status === 'ONLINE') score -= 25;

  const speedNum = parseFloat(input.speed) || 0;
  if (speedNum > 0 && speedNum < 0.85) score -= 20;
  if (input.fps > 0 && input.fps < 20) score -= 15;
  if (input.cpu > 90) score -= 15;
  if (input.cpu > 150) score -= 20;

  score = Math.max(0, Math.min(100, score));

  let health: HealthLevel = 'EXCELLENT';
  if (score < 85) health = 'GOOD';
  if (score < 65) health = 'WARNING';
  if (score < 40) health = 'CRITICAL';

  return { health, healthScore: score };
}

class ChannelHealthService {
  async getAllChannelHealth(): Promise<ChannelHealthReport[]> {
    const channels = await prisma.channel.findMany({
      select: { id: true, slug: true, name: true, status: true, useBlueprint: true },
    });
    const viewerCounts = viewerService.getAllCounts();

    const reports: ChannelHealthReport[] = [];

    for (const ch of channels) {
      const proc = ffmpegService.getProcessInfo(ch.id);
      const stats = proc?.stats;
      const segmentsActive = hasRecentHlsSegments(ch.slug);
      const speed = stats?.speed ?? '0x';
      const { health, healthScore } = scoreChannel({
        status: ch.status,
        cpu: stats?.cpu ?? 0,
        fps: stats?.fps ?? 0,
        speed,
        segmentsActive,
        procRunning: !!proc,
      });

      let playback: PlaybackDiagnosticsReport | undefined;
      const diag = await blueprintPlaybackService.getDiagnostics(ch.id);
      if (diag) {
        playback = {
          playbackSource: proc?.playbackSource ?? diag.playbackSource,
          blueprintName: diag.blueprintName,
          currentBlock: diag.currentBlock,
          currentPlaylist: diag.currentPlaylist,
          currentAsset: diag.currentAsset,
          nextBlock: diag.nextBlock,
          nextAsset: diag.nextAsset,
        };
      }

      reports.push({
        channelId: ch.id,
        slug: ch.slug,
        name: ch.name,
        status: ch.status,
        health,
        healthScore,
        cpu: stats?.cpu ?? 0,
        ram: stats?.ram ?? 0,
        bitrate: stats?.bitrate ?? 0,
        fps: stats?.fps ?? 0,
        speed,
        pid: proc?.pid ?? null,
        viewers: viewerCounts[ch.id] ?? 0,
        segmentsActive,
        uptime: stats?.uptime ?? 0,
        playback,
      });
    }

    return reports;
  }

  async getChannelHealth(channelId: string): Promise<ChannelHealthReport | null> {
    const all = await this.getAllChannelHealth();
    return all.find((c) => c.channelId === channelId) ?? null;
  }
}

export const channelHealthService = new ChannelHealthService();
