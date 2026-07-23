import { Router } from 'express';
import * as monitoringController from '../controllers/monitoring.controller';
import * as boostController from '../controllers/boost.controller';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// Worker endpoints — authenticated by node secret key, not dashboard JWT
router.post('/boost/worker/heartbeat', asyncHandler(boostController.workerHeartbeat));
router.get('/boost/install.sh', asyncHandler(boostController.getBoostInstallScript));

router.use(authenticateToken);

router.get('/stats', asyncHandler(monitoringController.getSystemStats));
router.get('/gpu', asyncHandler(monitoringController.getGpuEncoderStatus));
router.get('/health', asyncHandler(monitoringController.getChannelHealthAll));
router.get('/logs', asyncHandler(monitoringController.getGlobalLogs));
router.get('/app-logs', asyncHandler(monitoringController.getAppLogs));
router.get('/app-logs/export', asyncHandler(monitoringController.exportAppLogs));
router.get('/health/:channelId', asyncHandler(monitoringController.getChannelHealth));
router.get('/backup/export', asyncHandler(monitoringController.exportBackup));
router.post('/backup/import', asyncHandler(monitoringController.importBackup));

router.get('/boost/nodes', asyncHandler(boostController.listBoostNodes));
router.post('/boost/nodes', asyncHandler(boostController.createBoostNode));
router.put('/boost/nodes/:id', asyncHandler(boostController.updateBoostNode));
router.delete('/boost/nodes/:id', asyncHandler(boostController.deleteBoostNode));
router.post('/boost/nodes/:id/regenerate-key', asyncHandler(boostController.regenerateBoostNodeKey));

export default router;
