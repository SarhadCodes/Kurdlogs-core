import crypto from 'crypto';
import path from 'path';

export const generateSlug = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
};

export const generateToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

export const formatUptime = (seconds: number): string => {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const dDisplay = d > 0 ? d + (d == 1 ? "d " : "d ") : "";
  const hDisplay = h > 0 ? h + (h == 1 ? "h " : "h ") : "";
  const mDisplay = m > 0 ? m + (m == 1 ? "m " : "m ") : "";
  const sDisplay = s > 0 ? s + (s == 1 ? "s" : "s") : "";
  
  return dDisplay + hDisplay + mDisplay + sDisplay || '0s';
};

export const parseFfmpegProgress = (line: string) => {
  if (!line.includes('frame=') && !line.includes('size=')) return null;

  const stats: Record<string, string | number> = {};

  const frameMatch = line.match(/frame=\s*(\d+)/);
  if (frameMatch) stats.frames = parseInt(frameMatch[1], 10);

  const fpsMatch = line.match(/fps=\s*([\d.]+)/);
  if (fpsMatch) stats.fps = parseFloat(fpsMatch[1]);

  const bitrateMatch = line.match(/bitrate=\s*([\d.]+)\s*kbits\/s/i);
  if (bitrateMatch) stats.bitrate = parseFloat(bitrateMatch[1]);

  const sizeMatch = line.match(/size=\s*(\d+)\s*kB/i);
  if (sizeMatch) stats.size = parseInt(sizeMatch[1], 10);

  const speedMatch = line.match(/speed=\s*([\d.]+)x/);
  if (speedMatch) stats.speed = speedMatch[1] + 'x';

  const timeMatch = line.match(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (timeMatch) {
    const h = parseInt(timeMatch[1], 10);
    const m = parseInt(timeMatch[2], 10);
    const s = parseFloat(timeMatch[3]);
    stats.timeSec = h * 3600 + m * 60 + s;
  }

  return Object.keys(stats).length > 0 ? stats : null;
};

export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

export const sanitizePath = (inputPath: string): string => {
  // Prevent path traversal
  const normalizedPath = path.normalize(inputPath).replace(/^(\.\.(\/|\\|$))+/, '');
  return normalizedPath;
};
