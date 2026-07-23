import { Router } from 'express';
import * as transcodingController from '../controllers/transcoding.controller';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

router.use(authenticateToken);

router.get('/', asyncHandler(transcodingController.getAllProfiles));
router.post('/', asyncHandler(transcodingController.createProfile));
router.get('/:id', asyncHandler(transcodingController.getProfileById));
router.put('/:id', asyncHandler(transcodingController.updateProfile));
router.delete('/:id', asyncHandler(transcodingController.deleteProfile));

export default router;
