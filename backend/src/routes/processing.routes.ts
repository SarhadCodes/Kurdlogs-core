import { Router } from 'express';
import * as processingController from '../controllers/processing.controller';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();
router.use(authenticateToken);

router.get('/jobs', asyncHandler(processingController.listProcessingJobs));
router.get('/jobs/:id', asyncHandler(processingController.getProcessingJob));

export default router;
