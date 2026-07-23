import { Router } from 'express';
import * as channelController from '../controllers/channel.controller';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// Apply auth middleware to all routes
router.use(authenticateToken);

router.get('/', asyncHandler(channelController.getAllChannels));
router.post('/', asyncHandler(channelController.createChannel));
router.get('/:id', asyncHandler(channelController.getChannelById));
router.put('/:id', asyncHandler(channelController.updateChannel));
router.delete('/:id', asyncHandler(channelController.deleteChannel));

// Actions
router.post('/:id/start', asyncHandler(channelController.startChannel));
router.post('/:id/stop', asyncHandler(channelController.stopChannel));
router.post('/:id/restart', asyncHandler(channelController.restartChannel));
router.post('/:id/switch-mode', asyncHandler(channelController.switchMode));
router.post('/:id/playback-mode', asyncHandler(channelController.setPlaybackMode));

// Monitoring
router.get('/:id/stats', asyncHandler(channelController.getChannelStats));
router.get('/:id/logs', asyncHandler(channelController.getChannelLogs));
router.delete('/:id/logs', asyncHandler(channelController.clearChannelLogs));
router.get('/:id/play-urls', asyncHandler(channelController.getChannelPlayUrls));

export default router;
