import { Router } from 'express';
import * as iptvController from '../controllers/iptv.controller';
import { validateIptvApiKey } from '../middleware/iptvAuth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

router.get('/docs', validateIptvApiKey, asyncHandler(iptvController.getIptvDocs));
router.get('/channels', validateIptvApiKey, asyncHandler(iptvController.listChannels));
router.get('/channels/:slug/token', validateIptvApiKey, asyncHandler(iptvController.getStreamToken));
router.get('/channels/:slug', validateIptvApiKey, asyncHandler(iptvController.getChannel));

export default router;
