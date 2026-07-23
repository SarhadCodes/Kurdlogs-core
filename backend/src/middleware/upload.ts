import multer from 'multer';
import path from 'path';
import { env } from '../config/env';
import fs from 'fs';
import { AppError } from './errorHandler';

const videoDir = path.join(env.UPLOADS_DIR, 'videos');
const logoDir = path.join(env.UPLOADS_DIR, 'logos');
const avatarDir = path.join(env.UPLOADS_DIR, 'avatars');

if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
if (!fs.existsSync(logoDir)) fs.mkdirSync(logoDir, { recursive: true });
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const VIDEO_EXT = /\.(mp4|mkv|avi|mov|m4v|ts|m2ts|webm|flv|wmv|mpeg|mpg|3gp)$/i;

const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, videoDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, logoDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, avatarDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname).toLowerCase());
  },
});

const videoFilter = (_req: any, file: any, cb: any) => {
  if (file.mimetype.startsWith('video/') || file.mimetype === 'application/octet-stream') {
    cb(null, true);
    return;
  }
  if (VIDEO_EXT.test(file.originalname)) {
    cb(null, true);
    return;
  }
  cb(new AppError('Not a video file! Use MP4, MKV, MOV, TS, etc.', 400), false);
};

const imageFilter = (_req: any, file: any, cb: any) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new AppError('Not an image! Please upload only images.', 400), false);
  }
};

const maxUploadBytes = Math.max(100, env.MAX_UPLOAD_MB) * 1024 * 1024;

export const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: maxUploadBytes },
  fileFilter: videoFilter,
});

export const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: imageFilter,
});

export const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFilter,
});

export const MAX_UPLOAD_MB = env.MAX_UPLOAD_MB;
