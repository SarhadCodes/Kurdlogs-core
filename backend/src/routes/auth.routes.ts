import { Router } from 'express';
import {
  login,
  verifyMfaLogin,
  logout,
  register,
  getMe,
  changePassword,
  updateProfile,
  uploadAvatar,
  setupMfa,
  enableMfa,
  disableMfa,
  regenerateBackupCodes,
  getSecondaryUsers,
  createSecondaryUser,
  deleteSecondaryUser,
} from '../controllers/auth.controller';
import { authenticateToken, authenticateTokenSoft } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { avatarUpload } from '../middleware/upload';
import { loginLockMiddleware, loginRateLimiter } from '../middleware/loginGuard';

const router = Router();

router.post('/login', loginRateLimiter, loginLockMiddleware, asyncHandler(login));
router.post('/login/mfa', loginRateLimiter, loginLockMiddleware, asyncHandler(verifyMfaLogin));
router.post('/logout', asyncHandler(logout));

router.post('/register', authenticateToken, asyncHandler(register));
router.get('/secondary-users', authenticateToken, asyncHandler(getSecondaryUsers));
router.post('/secondary-users', authenticateToken, asyncHandler(createSecondaryUser));
router.delete('/secondary-users/:id', authenticateToken, asyncHandler(deleteSecondaryUser));
router.get('/me', authenticateTokenSoft, asyncHandler(getMe));
router.put('/profile', authenticateToken, asyncHandler(updateProfile));
router.post('/avatar', authenticateToken, avatarUpload.single('file'), asyncHandler(uploadAvatar));
router.put('/change-password', authenticateTokenSoft, asyncHandler(changePassword));

router.post('/mfa/setup', authenticateTokenSoft, asyncHandler(setupMfa));
router.post('/mfa/enable', authenticateTokenSoft, asyncHandler(enableMfa));
router.post('/mfa/disable', authenticateToken, asyncHandler(disableMfa));
router.post('/mfa/backup-codes/regenerate', authenticateToken, asyncHandler(regenerateBackupCodes));

export default router;
