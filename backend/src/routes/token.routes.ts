import { Router } from 'express';
import * as tokenController from '../controllers/token.controller';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// Public endpoint for NGINX auth_request
router.get('/validate', asyncHandler(tokenController.validateStreamToken));

router.use(authenticateToken);

router.get('/', asyncHandler(tokenController.getAllTokens));
router.post('/refresh-all', asyncHandler(tokenController.refreshAllTokens));
router.get('/channel/:channelId', asyncHandler(tokenController.getTokensForChannel));
router.post('/', asyncHandler(tokenController.createToken));
router.delete('/:id', asyncHandler(tokenController.deleteToken));
router.post('/:id/refresh', asyncHandler(tokenController.refreshToken));

export default router;
