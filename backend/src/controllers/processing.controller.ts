import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { processingQueueService } from '../services/processingQueue.service';

export const listProcessingJobs = async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 200);
  const status = req.query.status ? String(req.query.status) : undefined;
  const jobs = await prisma.processingJob.findMany({
    where: status ? { status: status as any } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      playlistItem: { select: { id: true, originalFilename: true, playlistId: true } },
    },
  });
  res.json({
    success: true,
    data: jobs,
    meta: { queuePending: processingQueueService.getPendingCount() },
  });
};

export const getProcessingJob = async (req: Request, res: Response) => {
  const job = await prisma.processingJob.findUnique({
    where: { id: String(req.params.id) },
    include: { playlistItem: true },
  });
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }
  res.json({ success: true, data: job });
};
