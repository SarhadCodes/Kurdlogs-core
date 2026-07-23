import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import * as ingestController from '../controllers/mcrIngest.controller';

const router = Router();

/** nginx-rtmp webhooks — no JWT. nginx-rtmp uses HTTP GET for on_publish callbacks. */
router.get('/on-publish', asyncHandler(ingestController.ingestOnPublish));
router.post('/on-publish', asyncHandler(ingestController.ingestOnPublish));
router.get('/on-publish-done', asyncHandler(ingestController.ingestOnPublishDone));
router.post('/on-publish-done', asyncHandler(ingestController.ingestOnPublishDone));

export default router;
