import { Router } from 'express';
import * as benchmarkController from '../controllers/benchmark.controller';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();
router.use(authenticateToken);

router.get('/status', asyncHandler(benchmarkController.benchmarkStatus));
router.get('/last', asyncHandler(benchmarkController.getLastBenchmark));
router.post('/run', asyncHandler(benchmarkController.runBenchmark));

export default router;
