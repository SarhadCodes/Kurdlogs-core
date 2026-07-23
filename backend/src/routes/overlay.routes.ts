import { Router } from 'express';
import * as overlayController from '../controllers/overlay.controller';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { logoUpload } from '../middleware/upload';

const router = Router();

router.use(authenticateToken);

router.get('/channel/:channelId', asyncHandler(overlayController.getOverlaysForChannel));
router.post('/channel/:channelId', logoUpload.single('logo'), asyncHandler(overlayController.createOverlay));
router.put('/:id', logoUpload.single('logo'), asyncHandler(overlayController.updateOverlay));
router.delete('/:id', asyncHandler(overlayController.deleteOverlay));

export default router;
