import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { parseCorsOrigins } from '../config/cors';
import { logger } from '../utils/logger';
import { WebSocketEvents } from '../types';
import { viewerService } from './viewer.service';
import { getClientIp } from '../utils/clientIp';
import { parseDeviceLabel, parsePlayerLabel } from '../utils/userAgent';
import type { ViewerMapPayload } from '../types';

class WebSocketService {
  private io!: Server;

  initialize(httpServer: HttpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: parseCorsOrigins(env.CORS_ORIGIN),
        methods: ['GET', 'POST'],
      },
    });

    this.io.use((socket, next) => {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }
      try {
        jwt.verify(token, env.JWT_SECRET);
        next();
      } catch (err) {
        next(new Error('Authentication error'));
      }
    });

    this.io.on('connection', (socket: Socket) => {
      logger.debug(`Socket connected: ${socket.id}`);
      socket.emit(WebSocketEvents.VIEWER_COUNT, viewerService.getAllCounts());
      socket.emit(WebSocketEvents.VIEWER_MAP, viewerService.getMapPayload());

      socket.on('subscribe:channel', (channelId: string) => {
        socket.join(`channel:${channelId}`);
      });

      socket.on('subscribe:mcr', (channelId: string) => {
        socket.join(`mcr:${channelId}`);
      });

      socket.on('unsubscribe:channel', (channelId: string) => {
        socket.leave(`channel:${channelId}`);
      });

      socket.on('unsubscribe:mcr', (channelId: string) => {
        socket.leave(`mcr:${channelId}`);
      });

      const deviceLabel = parseDeviceLabel(socket.handshake.headers['user-agent'] as string);
      const playerLabel = parsePlayerLabel(socket.handshake.headers['user-agent'] as string);

      socket.on(
        'viewer:heartbeat',
        (data: {
          channelId: string;
          viewerSessionId?: string;
          client?: { lat?: number; lng?: number; city?: string; country?: string };
          stream?: { quality?: string; bitrateKbps?: number; player?: string };
        }) => {
          if (data?.channelId) {
            const ip = getClientIp(socket);
            const viewerId =
              typeof data.viewerSessionId === 'string' && data.viewerSessionId.length >= 8
                ? data.viewerSessionId
                : socket.id;
            viewerService.heartbeat(
              data.channelId,
              viewerId,
              ip,
              deviceLabel,
              playerLabel,
              data.client,
              data.stream
            );
          }
        }
      );

      socket.on('disconnect', () => {
        logger.debug(`Socket disconnected: ${socket.id}`);
      });
    });

    logger.info('WebSocket server initialized');
  }

  emitChannelStatus(channelId: string, status: string) {
    if (this.io) {
      this.io.emit(WebSocketEvents.CHANNEL_STATUS, { channelId, status });
    }
  }

  emitChannelStats(channelId: string, stats: any) {
    if (this.io) {
      // Emit to channel specific room
      this.io.to(`channel:${channelId}`).emit(WebSocketEvents.CHANNEL_STATS, { channelId, stats });
      // Also emit to all for dashboard global view
      this.io.emit(WebSocketEvents.CHANNEL_STATS, { channelId, stats });
    }
  }

  emitLog(channelId: string, log: any) {
    if (this.io) {
      this.io.to(`channel:${channelId}`).emit(WebSocketEvents.CHANNEL_LOG, { channelId, log });
    }
  }

  emitSystemStats(stats: any) {
    if (this.io) {
      this.io.emit(WebSocketEvents.SYSTEM_STATS, stats);
    }
  }

  emitPlaylistItemStatus(itemId: string, playlistId: string, status: string, error?: string) {
    if (this.io) {
      this.io.emit(WebSocketEvents.PLAYLIST_ITEM_STATUS, { itemId, playlistId, status, error });
    }
  }

  emitProcessingJob(job: Record<string, unknown>) {
    if (this.io) {
      this.io.emit(WebSocketEvents.PROCESSING_JOB, job);
    }
  }

  emitBlueprintPlaybackSync(blueprintId: string, channelId: string, playbackEpoch: number) {
    if (this.io) {
      this.io.emit(WebSocketEvents.BLUEPRINT_PLAYBACK_SYNC, {
        blueprintId,
        channelId,
        playbackEpoch,
      });
    }
  }

  emitMcrState(channelId: string, state: Record<string, unknown>) {
    if (this.io) {
      this.io.to(`mcr:${channelId}`).emit(WebSocketEvents.MCR_STATE, { channelId, state });
      this.io.emit(WebSocketEvents.MCR_STATE, { channelId, state });
    }
  }

  emitMcrIngest(payload: { event: string; streamKey: string }) {
    if (this.io) {
      this.io.emit(WebSocketEvents.MCR_INGEST, payload);
    }
  }

  emitMcrSourcesUpdated(channelId: string) {
    if (this.io) {
      this.io.emit(WebSocketEvents.MCR_SOURCES, { channelId });
    }
  }

  emitMcrSessionReady(payload: {
    channelId: string;
    sourceId: string;
    sessionKey: string;
    manifest: string;
  }) {
    if (this.io) {
      this.io.to(`mcr:${payload.channelId}`).emit(WebSocketEvents.MCR_SESSION_READY, payload);
      this.io.emit(WebSocketEvents.MCR_SESSION_READY, payload);
    }
  }

  emitControlRoomState(channelId: string, state: Record<string, unknown>) {
    // Control Room removed
  }

  emitControlRoomLive(payload: { channelId: string; active: boolean }) {
    // Control Room removed
  }

  emitViewerCounts(counts: Record<string, number>) {
    if (this.io) {
      this.io.emit(WebSocketEvents.VIEWER_COUNT, counts);
    }
  }

  emitViewerMap(payload: ViewerMapPayload) {
    if (this.io) {
      this.io.emit(WebSocketEvents.VIEWER_MAP, payload);
    }
  }

  emitHybridState(channelId: string, state: unknown) {
    if (this.io) {
      this.io.to(`channel:${channelId}`).emit(WebSocketEvents.HYBRID_STATE, { channelId, state });
      this.io.emit(WebSocketEvents.HYBRID_STATE, { channelId, state });
    }
  }
}

export const wsService = new WebSocketService();
