import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../config/database';
import { AuthRequest, TokenPayload } from '../types';
import { AppError } from './errorHandler';

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next(new AppError('Authentication required', 401));
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    
    const user = await prisma.user.findUnique({
      where: { id: payload.userId }
    });

    if (!user) {
      return next(new AppError('User not found', 404));
    }

    req.user = user;
    next();
  } catch (error) {
    return next(new AppError('Invalid or expired token', 403));
  }
};

export const optionalAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next();
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    const user = await prisma.user.findUnique({
      where: { id: payload.userId }
    });
    
    if (user) {
      req.user = user;
    }
  } catch (error) {
    // Ignore error for optional auth
  }
  
  next();
};
