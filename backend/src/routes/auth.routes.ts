import { Router } from 'express';
import { login, register, getMe, changePassword } from '../controllers/auth.controller';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

router.post('/login', asyncHandler(login));
router.post('/register', authenticateToken, asyncHandler(register));
router.get('/me', authenticateToken, asyncHandler(getMe));
router.put('/change-password', authenticateToken, asyncHandler(changePassword));

export default router;
