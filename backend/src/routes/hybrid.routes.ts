import { Router } from 'express';
import * as hybridController from '../controllers/hybrid.controller';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

router.use(authenticateToken);

router.get('/:channelId', asyncHandler(hybridController.getHybridState));
router.patch('/:channelId', asyncHandler(hybridController.updateHybridConfig));
router.post('/:channelId/go-live', asyncHandler(hybridController.goLive));
router.post('/:channelId/return-to-schedule', asyncHandler(hybridController.returnToSchedule));

export default router;
