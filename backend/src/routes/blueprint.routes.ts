import { Router } from 'express';
import * as blueprintController from '../controllers/blueprint.controller';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();
router.use(authenticateToken);

router.get('/templates', asyncHandler(blueprintController.getTemplates));
router.get('/', asyncHandler(blueprintController.listBlueprints));
router.post('/', asyncHandler(blueprintController.createBlueprint));
router.get('/:id', asyncHandler(blueprintController.getBlueprint));
router.put('/:id', asyncHandler(blueprintController.updateBlueprint));
router.delete('/:id', asyncHandler(blueprintController.deleteBlueprint));
router.post('/:id/simulate', asyncHandler(blueprintController.simulateBlueprint));
router.get('/:id/summary', asyncHandler(blueprintController.getBlueprintSummary));
router.post('/:id/summary', asyncHandler(blueprintController.getBlueprintSummary));
router.post('/:id/timeline', asyncHandler(blueprintController.previewTimeline));
router.get('/:id/timeline/cached', asyncHandler(blueprintController.getCachedTimeline));
router.get('/:id/live-cursor', asyncHandler(blueprintController.getLiveCursor));
router.post('/:id/verify-observers', asyncHandler(blueprintController.verifyObservers));
router.post('/:id/verify-sync', asyncHandler(blueprintController.verifySync));
router.post('/:id/verify-execution', asyncHandler(blueprintController.verifyBlueprintExecution));
router.post('/:id/verify-consistency', asyncHandler(blueprintController.verifyExecutionConsistency));
router.get('/:id/preview', asyncHandler(blueprintController.previewBlueprint));
router.post('/:id/publish', asyncHandler(blueprintController.publishBlueprint));

export default router;
