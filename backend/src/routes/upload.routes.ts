import { Router } from 'express';
import * as uploadController from '../controllers/upload.controller';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { videoUpload, logoUpload } from '../middleware/upload';

const router = Router();

router.use(authenticateToken);

router.post('/video', videoUpload.single('file'), asyncHandler(uploadController.uploadVideo));
router.post('/logo', logoUpload.single('file'), asyncHandler(uploadController.uploadLogo));

export default router;
