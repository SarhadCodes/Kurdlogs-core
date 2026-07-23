import { Router } from 'express';
import authRoutes from './auth.routes';
import channelRoutes from './channel.routes';
import playlistRoutes from './playlist.routes';
import overlayRoutes from './overlay.routes';
import transcodingRoutes from './transcoding.routes';
import tokenRoutes from './token.routes';
import monitoringRoutes from './monitoring.routes';
import uploadRoutes from './upload.routes';
import streamRoutes from './stream.routes';
import iptvRoutes from './iptv.routes';
import brandProfileRoutes from './brandProfile.routes';
import processingRoutes from './processing.routes';
import benchmarkRoutes from './benchmark.routes';
import blueprintRoutes from './blueprint.routes';
import mcrRoutes from './mcr.routes';
import mcrIngestRoutes from './mcrIngest.routes';
import hybridRoutes from './hybrid.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/channels', channelRoutes);
router.use('/playlists', playlistRoutes);
router.use('/overlays', overlayRoutes);
router.use('/transcoding', transcodingRoutes);
router.use('/tokens', tokenRoutes);
router.use('/monitoring', monitoringRoutes);
router.use('/uploads', uploadRoutes);
router.use('/iptv', iptvRoutes);
router.use('/brand-profiles', brandProfileRoutes);
router.use('/processing', processingRoutes);
router.use('/benchmark', benchmarkRoutes);
router.use('/blueprints', blueprintRoutes);
// Ingest webhooks must mount before /mcr (which applies JWT to all /mcr/* paths).
router.use('/mcr/ingest', mcrIngestRoutes);
router.use('/mcr', mcrRoutes);
router.use('/hybrid', hybridRoutes);

export { streamRoutes };
export default router;
