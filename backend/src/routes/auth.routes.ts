import { Router } from 'express';
import {
  login,
  register,
  getMe,
  changePassword,
  updateProfile,
  uploadAvatar,
} from '../controllers/auth.controller';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { avatarUpload } from '../middleware/upload';

const router = Router();

router.post('/login', asyncHandler(login));
router.post('/register', authenticateToken, asyncHandler(register));
router.get('/me', authenticateToken, asyncHandler(getMe));
router.put('/profile', authenticateToken, asyncHandler(updateProfile));
router.post('/avatar', authenticateToken, avatarUpload.single('file'), asyncHandler(uploadAvatar));
router.put('/change-password', authenticateToken, asyncHandler(changePassword));

export default router;
