import { useEffect } from 'react';
import { wsService } from '../services/websocket';
import { getViewerGeoHint, peekViewerGeoHint } from '../utils/viewerGeo';
import { getOrCreateViewerSessionId, getViewerStreamMeta } from '../utils/viewerSession';

function buildHeartbeatPayload(channelId: string) {
  const client = peekViewerGeoHint();
  const stream = getViewerStreamMeta();
  return {
    channelId,
    viewerSessionId: getOrCreateViewerSessionId(),
    client: client
      ? {
          lat: client.lat,
          lng: client.lng,
          city: client.city,
          country: client.country,
        }
      : undefined,
    stream:
      stream.quality || stream.bitrateKbps || stream.player
        ? {
            quality: stream.quality,
            bitrateKbps: stream.bitrateKbps,
            player: stream.player,
          }
        : undefined,
  };
}

export function emitViewerHeartbeat(channelId: string) {
  const payload = buildHeartbeatPayload(channelId);
  if (payload.client) {
    wsService.emit('viewer:heartbeat', payload);
    return;
  }
  getViewerGeoHint().then((hint) => {
    wsService.emit('viewer:heartbeat', {
      channelId,
      client: {
        lat: hint.lat,
        lng: hint.lng,
        city: hint.city,
        country: hint.country,
      },
      stream: payload.stream,
    });
  });
}

export function useViewerHeartbeat(channelId: string | undefined, enabled: boolean) {
  useEffect(() => {
    if (!channelId || !enabled) return;

    getViewerGeoHint().finally(() => {
      emitViewerHeartbeat(channelId);
    });

    const interval = setInterval(() => emitViewerHeartbeat(channelId), 10_000);
    return () => clearInterval(interval);
  }, [channelId, enabled]);
}
