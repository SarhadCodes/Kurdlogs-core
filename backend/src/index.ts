import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import http from 'http';
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
let ready = false;

// Allow large playlist uploads (nginx also needs long proxy timeouts).
server.timeout = 7_200_000;
server.requestTimeout = 7_200_000;
server.headersTimeout = 7_200_000;

// Initialize WebSocket
wsService.initialize(server);

const corsOrigins = parseCorsOrigins(env.CORS_ORIGIN);

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

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
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Container/orchestrator readiness probe. It deliberately has no auth and
// only becomes healthy after the database connection and core workers start.
app.get('/healthz', (_req, res) => {
  res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'starting' });
});

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
    // A backend/container replacement is not an operator Stop. Keep the
    // desired ONLINE state and logical on-air clock so startup recovery can
    // resume the channel against the existing HLS buffer.
    await ffmpegService.stopStream(channelId, {
      preserveBlueprintRuntime: true,
      preserveOnAirSession: true,
      preserveDesiredState: true,
    });
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
     // The MCR slate is created lazily by the MCR input/encoder services when a
     // switcher channel is actually enabled. Starting it here used a full CPU
     // core encoding an unused 720p/30 black stream on Blueprint-only installs.

     const { mcrIngestService } = await import('./services/mcrIngest.service');
     mcrIngestService.startPoller();

     ready = true;

     // Recover channels that were running before shutdown (after MCR bus is ready)
     await ffmpegService.recoverChannels();

     const { channelDiagnosticService } = await import('./services/channelDiagnostic.service');
     await channelDiagnosticService.startContinuousMonitoring();

     // Control Room removed

     const { mcrStabilityService } = await import('./services/mcrStability.service');
     mcrStabilityService.start();
     
  } catch (error) {
     logger.error('Failed to start services:', error);
  }
});
