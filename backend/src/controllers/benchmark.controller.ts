import { Request, Response } from 'express';
import { benchmarkService } from '../services/benchmark.service';

export const getLastBenchmark = async (_req: Request, res: Response) => {
  res.json({ success: true, data: benchmarkService.getLastReport() });
};

export const runBenchmark = async (req: Request, res: Response) => {
  const channels = parseInt(String(req.body.channels || req.query.channels || '1'), 10);
  const allowed = [1, 5, 10, 20];
  const target = (allowed.includes(channels) ? channels : 1) as 1 | 5 | 10 | 20;
  const seconds = Math.min(parseInt(String(req.body.seconds || '30'), 10), 120);

  if (benchmarkService.isRunning()) {
    return res.status(409).json({ success: false, error: 'Benchmark already running' });
  }

  const report = await benchmarkService.run(target, seconds);
  res.json({ success: true, data: report });
};

export const benchmarkStatus = async (_req: Request, res: Response) => {
  res.json({ success: true, data: { running: benchmarkService.isRunning() } });
};
