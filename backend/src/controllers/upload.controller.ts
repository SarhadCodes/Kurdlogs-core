import { Request, Response } from 'express';
import path from 'path';

export const uploadVideo = async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No video file provided' });
  }

  res.status(201).json({
    success: true,
    data: {
      filename: req.file.filename,
      originalName: req.file.originalname,
      path: req.file.path,
      size: req.file.size
    }
  });
};

export const uploadLogo = async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No image file provided' });
  }

  res.status(201).json({
    success: true,
    data: {
      filename: req.file.filename,
      originalName: req.file.originalname,
      path: req.file.path,
      size: req.file.size
    }
  });
};
