import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest, TokenPayload } from '../types';
import { clearSessionCookie, setSessionCookie } from '../utils/authCookie';
import { assertStrongPassword } from '../utils/passwordPolicy';
import {
  buildMfaOtpauthUrl,
  buildMfaQrDataUrl,
  consumeBackupCode,
  generateBackupCodes,
  generateMfaSecret,
  rolesRequiringMfa,
  verifyTotp,
} from '../utils/mfa';
import { clearLoginFailures, recordLoginFailure } from '../middleware/loginGuard';

function publicUser(user: {
  id: string;
  username: string;
  role: string;
  mustChangePassword: boolean;
  mfaEnabled?: boolean;
  displayName?: string | null;
  avatarUrl?: string | null;
}) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    mfaEnabled: Boolean(user.mfaEnabled),
    mfaRequired: rolesRequiringMfa(user.role),
    displayName: user.displayName ?? null,
    avatarUrl: user.avatarUrl ?? null,
  };
}

function signSessionToken(user: { id: string; username: string; role: string }): string {
  const payload: TokenPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    purpose: 'session',
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });
}

function signMfaPendingToken(user: { id: string; username: string; role: string }): string {
  const payload: TokenPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    purpose: 'mfa_pending',
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '5m' });
}

function toPublicAvatarUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const marker = '/uploads/';
  const idx = normalized.lastIndexOf(marker);
  if (idx >= 0) return normalized.slice(idx);
  return `/uploads/avatars/${path.basename(normalized)}`;
}

function issueSession(res: Response, user: {
  id: string;
  username: string;
  role: string;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  displayName?: string | null;
  avatarUrl?: string | null;
}) {
  const token = signSessionToken(user);
  setSessionCookie(res, token);
  return {
    user: publicUser(user),
    requiresPasswordChange: user.mustChangePassword,
    requiresMfaSetup: rolesRequiringMfa(user.role) && !user.mfaEnabled,
  };
}

export const login = async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    recordLoginFailure(req);
    throw new AppError('Invalid credentials', 401);
  }

  const normalizedUsername = username.trim();
  const user =
    (await prisma.user.findUnique({ where: { username: normalizedUsername } })) ||
    (await prisma.user.findFirst({
      where: { username: { equals: normalizedUsername, mode: 'insensitive' } },
    }));
  if (!user) {
    recordLoginFailure(req);
    throw new AppError('Invalid credentials', 401);
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    recordLoginFailure(req);
    throw new AppError('Invalid credentials', 401);
  }

  clearLoginFailures(req);

  if (user.mfaEnabled) {
    const mfaToken = signMfaPendingToken(user);
    res.json({
      success: true,
      data: {
        mfaRequired: true,
        mfaToken,
        user: { username: user.username, role: user.role },
      },
    });
    return;
  }

  const session = issueSession(res, user);
  res.json({ success: true, data: session });
};

export const verifyMfaLogin = async (req: Request, res: Response) => {
  const { mfaToken, code } = req.body;
  if (typeof mfaToken !== 'string' || typeof code !== 'string') {
    recordLoginFailure(req);
    throw new AppError('Invalid MFA credentials', 401);
  }

  let payload: TokenPayload;
  try {
    payload = jwt.verify(mfaToken, env.JWT_SECRET) as TokenPayload;
  } catch {
    recordLoginFailure(req);
    throw new AppError('Invalid or expired MFA session', 401);
  }

  if (payload.purpose !== 'mfa_pending') {
    recordLoginFailure(req);
    throw new AppError('Invalid MFA session', 401);
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || !user.mfaEnabled || !user.mfaSecret) {
    recordLoginFailure(req);
    throw new AppError('Invalid MFA credentials', 401);
  }

  const totpOk = verifyTotp(user.mfaSecret, code);
  if (!totpOk) {
    const remaining = consumeBackupCode(user.mfaBackupCodes, code);
    if (!remaining) {
      recordLoginFailure(req);
      throw new AppError('Invalid MFA credentials', 401);
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaBackupCodes: JSON.stringify(remaining) },
    });
  }

  clearLoginFailures(req);
  const session = issueSession(res, user);
  res.json({ success: true, data: session });
};

export const logout = async (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.json({ success: true, message: 'Logged out' });
};

export const register = async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'ADMIN') {
    throw new AppError('Unauthorized', 403);
  }

  const { username, password, email, role } = req.body;
  assertStrongPassword(password, username);

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) throw new AppError('Username already exists', 400);

  const salt = await bcrypt.genSalt(12);
  const passwordHash = await bcrypt.hash(password, salt);

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      email,
      role: role || 'VIEWER',
      mustChangePassword: true,
    },
    select: {
      id: true,
      username: true,
      role: true,
      displayName: true,
      avatarUrl: true,
      mustChangePassword: true,
      mfaEnabled: true,
      createdAt: true,
    },
  });

  res.status(201).json({ success: true, data: publicUser(user) });
};

export const getMe = async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  res.json({
    success: true,
    data: publicUser(user),
  });
};

export const updateProfile = async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const rawName = typeof req.body.displayName === 'string' ? req.body.displayName.trim() : undefined;

  if (rawName === undefined) {
    throw new AppError('displayName is required', 400);
  }
  if (rawName.length > 64) {
    throw new AppError('Display name must be 64 characters or fewer', 400);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { displayName: rawName.length ? rawName : null },
  });

  res.json({ success: true, data: publicUser(updated) });
};

export const uploadAvatar = async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  if (!req.file) {
    throw new AppError('No image file provided', 400);
  }

  const avatarUrl = toPublicAvatarUrl(req.file.path);

  if (user.avatarUrl?.startsWith('/uploads/avatars/')) {
    const previous = path.join(env.UPLOADS_DIR, user.avatarUrl.replace(/^\/uploads\//, ''));
    if (fs.existsSync(previous) && previous !== req.file.path) {
      try {
        fs.unlinkSync(previous);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { avatarUrl },
  });

  res.json({ success: true, data: publicUser(updated) });
};

export const changePassword = async (req: AuthRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  const user = req.user!;

  assertStrongPassword(newPassword, user.username);

  const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isMatch) throw new AppError('Invalid current password', 400);

  if (currentPassword === newPassword) {
    throw new AppError('New password must be different from the current password', 400);
  }

  const salt = await bcrypt.genSalt(12);
  const passwordHash = await bcrypt.hash(newPassword, salt);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      mustChangePassword: false,
    },
  });

  // Refresh session cookie after password change
  const session = issueSession(res, updated);
  res.json({ success: true, message: 'Password updated successfully', data: session.user });
};

export const setupMfa = async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  if (user.mfaEnabled) {
    throw new AppError('MFA is already enabled', 400);
  }

  const secret = generateMfaSecret();
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaSecret: secret },
  });

  const otpauthUrl = buildMfaOtpauthUrl(user.username, secret);
  const qrDataUrl = await buildMfaQrDataUrl(otpauthUrl);

  res.json({
    success: true,
    data: {
      secret,
      otpauthUrl,
      qrDataUrl,
    },
  });
};

export const enableMfa = async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const { code } = req.body;

  if (!user.mfaSecret) {
    throw new AppError('Call MFA setup first', 400);
  }
  if (user.mfaEnabled) {
    throw new AppError('MFA is already enabled', 400);
  }
  if (!verifyTotp(user.mfaSecret, String(code || ''))) {
    throw new AppError('Invalid authenticator code', 400);
  }

  const backup = generateBackupCodes(8);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      mfaEnabled: true,
      mfaBackupCodes: JSON.stringify(backup.hashed),
    },
  });

  const session = issueSession(res, updated);
  res.json({
    success: true,
    data: {
      user: session.user,
      backupCodes: backup.plain,
    },
  });
};

export const disableMfa = async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const { password, code } = req.body;

  if (!user.mfaEnabled || !user.mfaSecret) {
    throw new AppError('MFA is not enabled', 400);
  }

  const isMatch = await bcrypt.compare(String(password || ''), user.passwordHash);
  if (!isMatch) throw new AppError('Invalid password', 400);

  const totpOk = verifyTotp(user.mfaSecret, String(code || ''));
  if (!totpOk) {
    const remaining = consumeBackupCode(user.mfaBackupCodes, String(code || ''));
    if (!remaining) throw new AppError('Invalid authenticator code', 400);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      mfaEnabled: false,
      mfaSecret: null,
      mfaBackupCodes: null,
    },
  });

  res.json({ success: true, data: publicUser(updated) });
};

export const regenerateBackupCodes = async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const { password, code } = req.body;

  if (!user.mfaEnabled || !user.mfaSecret) {
    throw new AppError('MFA is not enabled', 400);
  }

  const isMatch = await bcrypt.compare(String(password || ''), user.passwordHash);
  if (!isMatch) throw new AppError('Invalid password', 400);

  if (!verifyTotp(user.mfaSecret, String(code || ''))) {
    throw new AppError('Invalid authenticator code', 400);
  }

  const backup = generateBackupCodes(8);
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaBackupCodes: JSON.stringify(backup.hashed) },
  });

  res.json({
    success: true,
    data: { backupCodes: backup.plain },
  });
};
