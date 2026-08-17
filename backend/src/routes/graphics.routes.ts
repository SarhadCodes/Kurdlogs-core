import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as controller from '../controllers/graphics.controller';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { requireGraphicsOperator } from '../middleware/graphicsAccess';
import { logoUpload } from '../middleware/upload';

const router = Router();
const commandLimit = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
router.use(authenticateToken);

router.get('/assets', asyncHandler(controller.listAssets));
router.post('/assets', requireGraphicsOperator, logoUpload.single('asset'), asyncHandler(controller.uploadAsset));
router.get('/channels/:channelId', asyncHandler(controller.getGraphics));
router.put('/channels/:channelId', requireGraphicsOperator, commandLimit, asyncHandler(controller.saveGraphics));
router.post('/channels/:channelId/publish', requireGraphicsOperator, commandLimit, asyncHandler(controller.publishGraphics));
router.post('/channels/:channelId/visibility', requireGraphicsOperator, commandLimit, asyncHandler(controller.setVisibility));

export default router;
