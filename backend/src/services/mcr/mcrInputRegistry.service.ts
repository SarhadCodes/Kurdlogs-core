import path from 'path';
import { prisma } from '../../config/database';
import { McrSourceType } from '@prisma/client';
import { getStreamRoot } from '../../utils/streamPaths';
import { mcrIngestService } from '../mcrIngest.service';
import { mcrRelayService, type McrRelayInput } from '../mcrRelay.service';
import { mcrSourceSessionService } from '../mcrSourceSession.service';
import { mcrSlateService } from './mcrSlate.service';

export interface McrRegisteredInput {
  sourceId: string;
  label: string;
  sourceType: McrSourceType;
  /** HLS file path for the permanent program encoder input slot */
  hlsPath: string;
  sessionKey: string;
  slotIndex: number;
}

export interface McrInputRegistrySnapshot {
  channelId: string;
  slateSlot: number;
  inputs: McrRegisteredInput[];
  sourceIdToSlot: Record<string, number>;
}

/**
 * Input Registry — maps McrSource rows to persistent session HLS taps
 * consumed by the permanent program switcher encoder.
 */
class McrInputRegistryService {
  readonly SLATE_SLOT = 0;

  async resolveUpstreamInput(source: {
    sourceType: McrSourceType;
    refChannelId: string | null;
    inputUrl: string | null;
    streamKey?: string | null;
  }): Promise<McrRelayInput | null> {
    if (source.sourceType === 'BLUEPRINT' || source.sourceType === 'PLAYLIST') {
      if (!source.refChannelId) return null;
      const ch = await prisma.channel.findUnique({
        where: { id: source.refChannelId },
        select: { slug: true },
      });
      if (!ch) return null;
      return mcrRelayService.resolveChannelHlsInput(ch.slug);
    }

    const url =
      source.sourceType === 'RTMP_INGEST' && source.streamKey
        ? mcrIngestService.getInternalRtmpUrl(source.streamKey)
        : source.inputUrl;

    if (!url) return null;

    switch (source.sourceType) {
      case 'RTMP':
      case 'RTMP_INGEST':
        return { url, kind: 'RTMP' };
      case 'SRT':
        return { url, kind: 'SRT' };
      case 'RTSP':
        return { url, kind: 'RTSP' };
      case 'HLS':
        return { url, kind: 'HLS_URL' };
      case 'MPEGTS':
        return { url, kind: 'MPEGTS' };
      case 'UDP':
        return { url, kind: 'UDP' };
      case 'EMERGENCY':
        return { url, kind: 'HLS_FILE' };
      default:
        return { url, kind: 'HTTP' };
    }
  }

  private sessionHlsPath(routerChannelId: string, sourceId: string): string {
    const sessionKey = mcrSourceSessionService.getSessionKey(routerChannelId, sourceId);
    return path.join(getStreamRoot(sessionKey), 'index.m3u8');
  }

  /** Ensure sessions are warm and build slot map for the switcher encoder. */
  async buildRegistry(channelId: string): Promise<McrInputRegistrySnapshot> {
    const router = await prisma.mcrRouterState.findUnique({
      where: { channelId },
      include: { sources: { where: { enabled: true }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!router) {
      return { channelId, slateSlot: this.SLATE_SLOT, inputs: [], sourceIdToSlot: {} };
    }

    await mcrSlateService.ensureSlate();

    const inputs: McrRegisteredInput[] = [];
    const sourceIdToSlot: Record<string, number> = {};
    let slot = 1;

    for (const source of router.sources) {
      const upstream = await this.resolveUpstreamInput(source);
      if (!upstream) continue;

      await mcrSourceSessionService.ensureSession(channelId, source.id, upstream, source.label);

      const sessionKey = mcrSourceSessionService.getSessionKey(channelId, source.id);
      const hlsPath = this.sessionHlsPath(channelId, source.id);

      inputs.push({
        sourceId: source.id,
        label: source.label,
        sourceType: source.sourceType,
        hlsPath,
        sessionKey,
        slotIndex: slot,
      });
      sourceIdToSlot[source.id] = slot;
      slot += 1;
    }

    return { channelId, slateSlot: this.SLATE_SLOT, inputs, sourceIdToSlot };
  }

  getSlotForSource(registry: McrInputRegistrySnapshot, sourceId: string | null | undefined): number {
    if (!sourceId) return registry.slateSlot;
    return registry.sourceIdToSlot[sourceId] ?? registry.slateSlot;
  }
}

export const mcrInputRegistryService = new McrInputRegistryService();
