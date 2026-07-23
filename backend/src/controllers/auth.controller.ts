import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';

function publicUser(user: {
  id: string;
  username: string;
  role: string;
  mustChangePassword: boolean;
  displayName?: string | null;
  avatarUrl?: string | null;
}) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    displayName: user.displayName ?? null,
    avatarUrl: user.avatarUrl ?? null,
  };
}

function toPublicAvatarUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const marker = '/uploads/';
  const idx = normalized.lastIndexOf(marker);
  if (idx >= 0) return normalized.slice(idx);
  return `/uploads/avatars/${path.basename(normalized)}`;
}

export const login = async (req: Request, res: Response) => {
  const { username, password } = req.body;

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw new AppError('Invalid credentials', 401);

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) throw new AppError('Invalid credentials', 401);

  const token = jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN as any }
  );

  res.json({
    success: true,
    data: {
      token,
      user: publicUser(user),
    },
  });
};

export const register = async (req: AuthRequest, res: Response) => {
  // Only admins can register new users
  if (req.user?.role !== 'ADMIN') {
    throw new AppError('Unauthorized', 403);
  }

  const { username, password, email, role } = req.body;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) throw new AppError('Username already exists', 400);

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      email,
      role: role || 'VIEWER',
    },
    select: {
      id: true,
      username: true,
      role: true,
      displayName: true,
      avatarUrl: true,
      createdAt: true,
    },
  });

  res.status(201).json({ success: true, data: user });
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

  const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isMatch) throw new AppError('Invalid current password', 400);

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(newPassword, salt);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      mustChangePassword: false,
    },
  });

  res.json({ success: true, message: 'Password updated successfully' });
};
