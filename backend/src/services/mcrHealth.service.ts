import { prisma } from '../config/database';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { ffmpegService } from './ffmpeg.service';
import { hasRecentHlsSegments, getPublishedHlsManifest } from '../utils/streamPaths';
import { mcrIngestService } from './mcrIngest.service';
import { probeStream } from './streamProbe.service';
import type { McrSource, McrSourceType } from '@prisma/client';

export type McrSourceHealthStatus = 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'UNKNOWN';

export interface McrSourceHealth {
  sourceId: string;
  label: string;
  sourceType: McrSourceType;
  status: McrSourceHealthStatus;
  bitrate: number;
  fps: number;
  resolution: string | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  audioCodec: string | null;
  lastUpdate: string;
  refChannelId?: string | null;
  inputUrl?: string | null;
  streamKey?: string | null;
}

class McrHealthService {
  async checkSource(source: McrSource): Promise<McrSourceHealth> {
    const base: McrSourceHealth = {
      sourceId: source.id,
      label: source.label,
      sourceType: source.sourceType,
      status: 'UNKNOWN',
      bitrate: 0,
      fps: 0,
      resolution: null,
      width: null,
      height: null,
      hasAudio: false,
      audioCodec: null,
      lastUpdate: new Date().toISOString(),
      refChannelId: source.refChannelId,
      inputUrl: source.inputUrl,
      streamKey: source.streamKey,
    };

    try {
      if (source.sourceType === 'BLUEPRINT' || source.sourceType === 'PLAYLIST') {
        if (!source.refChannelId) {
          base.status = 'OFFLINE';
          return base;
        }
        const ch = await prisma.channel.findUnique({
          where: { id: source.refChannelId },
          select: { slug: true, status: true, transcodingProfile: { select: { resolution: true } } },
        });
        if (!ch) {
          base.status = 'OFFLINE';
          return base;
        }
        const procInfo = ffmpegService.getProcessInfo(source.refChannelId);
        const live = hasRecentHlsSegments(ch.slug) || !!procInfo;
        base.status =
          ch.status === 'ONLINE' && live
            ? 'ONLINE'
            : ch.status === 'STARTING'
              ? 'DEGRADED'
              : 'OFFLINE';
        if (procInfo?.stats) {
          base.bitrate = procInfo.stats.bitrate ?? 0;
          base.fps = procInfo.stats.fps ?? 0;
        }
        if (ch.transcodingProfile?.resolution) {
          const resMap: Record<string, string> = {
            RES_1080P: '1920x1080',
            RES_720P: '1280x720',
            RES_480P: '854x480',
          };
          base.resolution = resMap[ch.transcodingProfile.resolution] ?? null;
        }
        base.hasAudio = live;
        return base;
      }

      if (source.sourceType === 'RTMP_INGEST' && source.streamKey) {
        const pub = await prisma.mcrIngestPublisher.findUnique({
          where: { streamKey: source.streamKey },
        });
        if (pub?.active) {
          base.status = 'ONLINE';
          base.bitrate = pub.bitrate ?? 0;
          base.fps = pub.fps ?? 0;
          base.width = pub.width;
          base.height = pub.height;
          base.resolution = pub.width && pub.height ? `${pub.width}x${pub.height}` : null;
          base.hasAudio = pub.hasAudio ?? false;
          return base;
        }
        base.status = 'OFFLINE';
        return base;
      }

      if (source.sourceType === 'NDI') {
        base.status = 'OFFLINE';
        return base;
      }

      if (source.sourceType === 'EMERGENCY') {
        base.status = source.inputUrl ? 'ONLINE' : 'OFFLINE';
        return base;
      }

      if (!source.inputUrl) {
        base.status = 'OFFLINE';
        return base;
      }

      const probe = await probeStream(source.inputUrl);
      base.status = probe.online ? 'ONLINE' : 'OFFLINE';
      base.bitrate = probe.bitrate;
      base.fps = probe.fps;
      base.resolution = probe.resolution;
      base.width = probe.width;
      base.height = probe.height;
      base.hasAudio = probe.hasAudio;
      base.audioCodec = probe.audioCodec;
      return base;
    } catch (err) {
      logger.warn(`[MCR_HEALTH] sourceId=${source.id} check failed: ${err}`);
      base.status = 'OFFLINE';
      return base;
    }
  }

  async checkAllSources(sources: McrSource[]): Promise<McrSourceHealth[]> {
    return Promise.all(sources.map((s) => this.checkSource(s)));
  }

  isChannelStreamReady(slug: string): boolean {
    return !!getPublishedHlsManifest(slug) && hasRecentHlsSegments(slug);
  }
}

export const mcrHealthService = new McrHealthService();
