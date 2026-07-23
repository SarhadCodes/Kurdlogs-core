import type { Request } from 'express';
import geoip from 'geoip-lite';
import { wsService } from './websocket.service';
import { channelService } from './channel.service';
import { isPrivateIp, localNetworkGeo, resolveIpGeo } from './ipGeo.service';
import { logger } from '../utils/logger';
import { getRequestClientIp } from '../utils/clientIp';
import { parseDeviceLabel, parsePlayerLabel } from '../utils/userAgent';
import { resolveStreamViewerId } from '../utils/viewerSession';
import type { ViewerLocation, ViewerMapPayload } from '../types';

const VIEWER_TIMEOUT_MS = 45_000;
const BROADCAST_INTERVAL_MS = 5_000;

interface ViewerEntry {
  firstSeen: number;
  lastSeen: number;
  lat?: number;
  lng?: number;
  city?: string;
  country?: string;
  countryCode?: string;
  device?: string;
  player?: string;
  isp?: string;
  quality?: string;
  bitrateKbps?: number;
}

interface ClientGeoHint {
  lat?: number;
  lng?: number;
  city?: string;
  country?: string;
}

interface ClientStreamMeta {
  quality?: string;
  bitrateKbps?: number;
  player?: string;
}

function resolveGeo(ip: string, hint?: ClientGeoHint): Omit<ViewerEntry, 'firstSeen' | 'lastSeen'> {
  if (hint?.lat != null && hint?.lng != null) {
    return {
      lat: hint.lat,
      lng: hint.lng,
      city: hint.city,
      country: hint.country,
    };
  }

  if (isPrivateIp(ip)) {
    return localNetworkGeo();
  }

  const cleanIp = ip.replace(/^::ffff:/, '');
  const lookup = geoip.lookup(cleanIp);
  if (!lookup?.ll) return {};

  return {
    lat: lookup.ll[0],
    lng: lookup.ll[1],
    city: lookup.city,
    country: lookup.country,
    countryCode: lookup.country,
  };
}

function applyIpGeo(entry: ViewerEntry, geo: NonNullable<Awaited<ReturnType<typeof resolveIpGeo>>>) {
  if (geo.lat != null && geo.lng != null) {
    entry.lat = geo.lat;
    entry.lng = geo.lng;
  }
  if (geo.city) entry.city = geo.city;
  if (geo.country) entry.country = geo.country;
  if (geo.countryCode) entry.countryCode = geo.countryCode;
  if (geo.isp) entry.isp = geo.isp;
}

class ViewerService {
  private viewers: Map<string, Map<string, ViewerEntry>> = new Map();
  private broadcastTimer: NodeJS.Timeout | null = null;
  private slugToChannelId = new Map<string, string>();

  start() {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setInterval(() => this.cleanAndBroadcast(), BROADCAST_INTERVAL_MS);
    logger.info('Viewer tracking service started');
  }

  stop() {
    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
      this.broadcastTimer = null;
    }
  }

  heartbeat(
    channelId: string,
    viewerId: string,
    ip: string,
    deviceLabel: string,
    playerLabel: string,
    clientHint?: ClientGeoHint,
    streamMeta?: ClientStreamMeta
  ) {
    this.touch(channelId, viewerId, ip, deviceLabel, playerLabel, clientHint, streamMeta);
  }

  /** Count anyone fetching the public HLS/DASH output (VLC, IPTV, embed, web player). */
  async touchFromStream(req: Request, slug: string) {
    if (slug.startsWith('mcr-sess-')) return;

    let channelId = this.slugToChannelId.get(slug);
    if (!channelId) {
      try {
        const channel = await channelService.getChannelBySlug(slug);
        channelId = channel.id;
        this.slugToChannelId.set(slug, channelId);
      } catch {
        return;
      }
    }

    const ip = getRequestClientIp(req);
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';
    const viewerId = resolveStreamViewerId(req, slug);
    this.touch(
      channelId,
      viewerId,
      ip,
      parseDeviceLabel(userAgent),
      parsePlayerLabel(userAgent)
    );
  }

  private touch(
    channelId: string,
    viewerId: string,
    ip: string,
    deviceLabel: string,
    playerLabel: string,
    clientHint?: ClientGeoHint,
    streamMeta?: ClientStreamMeta
  ) {
    if (!this.viewers.has(channelId)) {
      this.viewers.set(channelId, new Map());
    }
    const now = Date.now();
    const existing = this.viewers.get(channelId)!.get(viewerId);
    const geo = resolveGeo(ip, clientHint);
    const player = streamMeta?.player || existing?.player || playerLabel;

    this.viewers.get(channelId)!.set(viewerId, {
      firstSeen: existing?.firstSeen ?? now,
      lastSeen: now,
      lat: geo.lat ?? existing?.lat,
      lng: geo.lng ?? existing?.lng,
      city: geo.city ?? existing?.city,
      country: geo.country ?? existing?.country,
      countryCode: geo.countryCode ?? existing?.countryCode,
      device: existing?.device ?? deviceLabel,
      player,
      isp: existing?.isp,
      quality: streamMeta?.quality ?? existing?.quality,
      bitrateKbps: streamMeta?.bitrateKbps ?? existing?.bitrateKbps,
    });

    const entry = this.viewers.get(channelId)!.get(viewerId)!;
    const needsRemoteGeo =
      !clientHint?.lat &&
      !clientHint?.lng &&
      !isPrivateIp(ip) &&
      (entry.lat == null || entry.lng == null || !entry.city || !entry.isp);

    if (needsRemoteGeo) {
      void resolveIpGeo(ip).then((geo) => {
        if (!geo) return;
        const entry = this.viewers.get(channelId)?.get(viewerId);
        if (!entry) return;
        applyIpGeo(entry, geo);
        wsService.emitViewerCounts(this.getAllCounts());
        wsService.emitViewerMap(this.getMapPayload());
      });
    }
  }

  removeViewer(viewerId: string) {
    for (const viewers of this.viewers.values()) {
      viewers.delete(viewerId);
    }
  }

  getCount(channelId: string): number {
    const channelViewers = this.viewers.get(channelId);
    if (!channelViewers) return 0;
    return channelViewers.size;
  }

  getAllCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [channelId, viewers] of this.viewers.entries()) {
      counts[channelId] = viewers.size;
    }
    return counts;
  }

  getMapPayload(): ViewerMapPayload {
    const now = Date.now();
    const channels: Record<string, ViewerLocation[]> = {};
    for (const [channelId, viewers] of this.viewers.entries()) {
      channels[channelId] = [];
      let idx = 0;
      for (const [viewerId, entry] of viewers.entries()) {
        idx += 1;
        channels[channelId].push({
          id: viewerId,
          label: `Viewer ${idx}`,
          lat: entry.lat,
          lng: entry.lng,
          city: entry.city,
          country: entry.country,
          countryCode: entry.countryCode,
          lastSeen: entry.lastSeen,
          firstSeen: entry.firstSeen,
          connectedSeconds: Math.max(0, Math.floor((now - entry.firstSeen) / 1000)),
          device: entry.device,
          player: entry.player,
          isp: entry.isp,
          quality: entry.quality,
          bitrateKbps: entry.bitrateKbps,
        });
      }
    }
    return { channels };
  }

  getChannelLocations(channelId: string): ViewerLocation[] {
    return this.getMapPayload().channels[channelId] ?? [];
  }

  private cleanAndBroadcast() {
    const now = Date.now();
    for (const [channelId, viewers] of this.viewers.entries()) {
      for (const [viewerId, entry] of viewers.entries()) {
        if (now - entry.lastSeen > VIEWER_TIMEOUT_MS) {
          viewers.delete(viewerId);
        }
      }
      if (viewers.size === 0) {
        this.viewers.delete(channelId);
      }
    }
    wsService.emitViewerCounts(this.getAllCounts());
    wsService.emitViewerMap(this.getMapPayload());
  }
}

export const viewerService = new ViewerService();
