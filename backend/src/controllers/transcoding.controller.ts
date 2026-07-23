import { Request, Response } from 'express';
import { transcodingService } from '../services/transcoding.service';

export const getAllProfiles = async (req: Request, res: Response) => {
  const profiles = await transcodingService.getAllProfiles();
  res.json({ success: true, data: profiles });
};

export const getProfileById = async (req: Request, res: Response) => {
  const profile = await transcodingService.getProfileById(String(req.params.id));
  res.json({ success: true, data: profile });
};

export const createProfile = async (req: Request, res: Response) => {
  const profile = await transcodingService.createProfile(req.body);
  res.status(201).json({ success: true, data: profile });
};

export const updateProfile = async (req: Request, res: Response) => {
  const profile = await transcodingService.updateProfile(String(req.params.id), req.body);
  res.json({ success: true, data: profile });
};

export const deleteProfile = async (req: Request, res: Response) => {
  await transcodingService.deleteProfile(String(req.params.id));
  res.json({ success: true, message: 'Profile deleted' });
};
