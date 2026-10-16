import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';

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
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        mustChangePassword: user.mustChangePassword
      }
    }
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
      role: role || 'VIEWER'
    },
    select: {
      id: true,
      username: true,
      role: true,
      createdAt: true
    }
  });

  res.status(201).json({ success: true, data: user });
};

export const getMe = async (req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    data: {
      id: req.user?.id,
      username: req.user?.username,
      role: req.user?.role,
      mustChangePassword: req.user?.mustChangePassword
    }
  });
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
      mustChangePassword: false
    }
  });

  res.json({ success: true, message: 'Password updated successfully' });
};
