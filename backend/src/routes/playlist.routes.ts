import { Router } from 'express';
import * as playlistController from '../controllers/playlist.controller';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { videoUpload, logoUpload } from '../middleware/upload';

const router = Router();

router.use(authenticateToken);

router.get('/', asyncHandler(playlistController.getAllPlaylists));
router.post('/', asyncHandler(playlistController.createPlaylist));
router.get('/:id', asyncHandler(playlistController.getPlaylistById));
router.put('/:id', asyncHandler(playlistController.updatePlaylist));
router.delete('/:id', asyncHandler(playlistController.deletePlaylist));

// Items
router.post('/:id/items', videoUpload.single('video'), asyncHandler(playlistController.addItem));
router.put('/items/:itemId/replace', videoUpload.single('video'), asyncHandler(playlistController.replaceItem));
router.put('/items/:itemId/logo', logoUpload.single('logo'), asyncHandler(playlistController.updateItemLogo));
router.post('/items/:itemId/retry-normalize', asyncHandler(playlistController.retryNormalize));
router.delete('/items/:itemId', asyncHandler(playlistController.removeItem));
router.put('/:id/items/reorder', asyncHandler(playlistController.reorderItems));

export default router;
