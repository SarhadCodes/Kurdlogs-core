import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { env } from './config/env';
import { parseCorsOrigins, corsOriginAllowed } from './config/cors';
import { logger } from './utils/logger';
import apiRoutes, { streamRoutes } from './routes';
import { errorHandler } from './middleware/errorHandler';
import { wsService } from './services/websocket.service';
import { monitorService } from './services/monitor.service';
import { tokenService } from './services/token.service';
import { ffmpegService } from './services/ffmpeg.service';
import { gpuEncoderService } from './services/gpuEncoder.service';
import { viewerService } from './services/viewer.service';
import { prisma } from './config/database';

const app = express();
const server = http.createServer(app);

// Allow large playlist uploads (nginx also needs long proxy timeouts).
server.timeout = 7_200_000;
server.requestTimeout = 7_200_000;
server.headersTimeout = 7_200_000;

// Initialize WebSocket
wsService.initialize(server);

const corsOrigins = parseCorsOrigins(env.CORS_ORIGIN);

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      if (corsOriginAllowed(origin, corsOrigins)) {
        callback(null, true);
        return;
      }
      logger.warn(`CORS blocked origin: ${origin}`);
      callback(null, false);
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static uploads
app.use('/uploads', express.static(env.UPLOADS_DIR));

// API Routes
app.use('/api', apiRoutes);

// Stream Routes (no /api prefix)
app.use('/stream', streamRoutes);

// Error Handler
app.use(errorHandler);

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down gracefully...');
  
  // Stop all FFmpeg streams
  const processes = ffmpegService.getAllProcesses();
  for (const [channelId] of processes) {
    await ffmpegService.stopStream(channelId);
  }
  
  // Stop services
  ffmpegService.stopWatchdog();
  monitorService.stopMonitoring();
  tokenService.stopTokenRefreshCron();
  viewerService.stop();
  const { boostService } = await import('./services/boost.service');
  boostService.stop();
  
  const { mcrStabilityService } = await import('./services/mcrStability.service');
  mcrStabilityService.stop();
  
  // Close DB
  await prisma.$disconnect();
  
  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
});

// Start server
server.listen(env.PORT, async () => {
  logger.info(`Server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
  
  // Connect to DB implicitly by running a query
  try {
     await prisma.$connect();
     logger.info('Database connected');
     
     gpuEncoderService.probe();

     const { mcrRtmpAuditService } = await import('./services/mcrRtmpAudit.service');
     mcrRtmpAuditService.runStartupAudit();

     // Start background services
     monitorService.startMonitoring();
     tokenService.startTokenRefreshCron();
     ffmpegService.startWatchdog();
     viewerService.start();
     const { boostService } = await import('./services/boost.service');
     boostService.start();

     // Migrate MCR URLs before any channel recovery
     const { sourceRouterService } = await import('./services/sourceRouter.service');
     await sourceRouterService.migrateAllEnabledMcrChannels();
     await sourceRouterService.recoverRelaysOnStartup();
     if (env.MCR_ARCHITECTURE === 'v2-switcher') {
       const { mcrSlateService } = await import('./services/mcr/mcrSlate.service');
       void mcrSlateService.ensureSlate().catch((err) =>
         logger.warn(`[MCR_SLATE] startup ensure failed: ${err}`)
       );
     }

     const { mcrIngestService } = await import('./services/mcrIngest.service');
     mcrIngestService.startPoller();

     // Recover channels that were running before shutdown (after MCR bus is ready)
     await ffmpegService.recoverChannels();

     // Control Room removed

     const { mcrStabilityService } = await import('./services/mcrStability.service');
     mcrStabilityService.start();
     
  } catch (error) {
     logger.error('Failed to start services:', error);
  }
});
