import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requireOperator } from '../middleware/requireOperator';
import { asyncHandler } from '../middleware/errorHandler';
import * as mcrController from '../controllers/mcr.controller';

const router = Router();

router.use(authenticateToken);

router.get('/channels', asyncHandler(mcrController.listMcrChannels));
router.get('/available-channels', asyncHandler(mcrController.listAvailableChannels));
router.get('/ingest/publishers', asyncHandler(mcrController.listIngestPublishers));
router.post('/ingest/keys', requireOperator, asyncHandler(mcrController.createIngestKey));
router.get('/:channelId', asyncHandler(mcrController.getMcrState));
router.post('/:channelId/init', requireOperator, asyncHandler(mcrController.initMcr));
router.post('/:channelId/discover', requireOperator, asyncHandler(mcrController.discoverMcrSources));
router.post('/:channelId/sources', requireOperator, asyncHandler(mcrController.addMcrSource));
router.post('/:channelId/preview', requireOperator, asyncHandler(mcrController.setMcrPreview));
router.post('/:channelId/take', requireOperator, asyncHandler(mcrController.takeMcr));
router.post('/:channelId/cut', requireOperator, asyncHandler(mcrController.cutMcr));
router.post('/:channelId/auto', requireOperator, asyncHandler(mcrController.autoMcr));
router.post('/:channelId/sources/rtmp', requireOperator, asyncHandler(mcrController.addRtmpSource));
router.get('/:channelId/sources/:sourceId/preview-url', asyncHandler(mcrController.getSourcePreviewUrl));

export default router;
