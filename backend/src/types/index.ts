import { ChildProcess } from 'child_process';
import { Request } from 'express';
import { User } from '@prisma/client';

export interface FfmpegProcessInfo {
  pid: number;
  channelId: string;
  process: ChildProcess;
  inputType: string;
  playbackSource?: 'BLUEPRINT' | 'PLAYLIST' | 'MCR_BUS' | 'MCR_SWITCHER';
  startTime: Date;
  stats: StreamStats;
  lastProgressTime: number;
  markedOnline: boolean;
  sourceUnreachable: boolean;
}

export interface StreamStats {
  cpu: number;
  ram: number;
  gpu: number;
  bitrate: number;
  fps: number;
  uptime: number;
  timeSec?: number;
  speed: string;
  frames: number;
}

export interface TokenPayload {
  userId: string;
  username: string;
  role: string;
}

export interface AuthRequest extends Request {
  user?: User;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export enum WebSocketEvents {
  CHANNEL_STATUS = 'channel:status',
  CHANNEL_STATS = 'channel:stats',
  CHANNEL_LOG = 'channel:log',
  SYSTEM_STATS = 'system:stats',
  PLAYLIST_ITEM_STATUS = 'playlist:item:status',
  PROCESSING_JOB = 'processing:job',
  VIEWER_COUNT = 'viewer:count',
  VIEWER_MAP = 'viewer:map',
  BLUEPRINT_PLAYBACK_SYNC = 'blueprint:playback-sync',
  MCR_STATE = 'mcr:state',
  MCR_INGEST = 'mcr:ingest',
  MCR_SOURCES = 'mcr:sources',
  MCR_SESSION_READY = 'mcr:session-ready',
  HYBRID_STATE = 'hybrid:state',
}

export interface ViewerLocation {
  id: string;
  label: string;
  lat?: number;
  lng?: number;
  city?: string;
  country?: string;
  countryCode?: string;
  lastSeen: number;
  firstSeen: number;
  connectedSeconds: number;
  device?: string;
  player?: string;
  isp?: string;
  quality?: string;
  bitrateKbps?: number;
}

export interface ViewerMapPayload {
  channels: Record<string, ViewerLocation[]>;
}

export interface OverlayConfig {
  x?: number | string;
  y?: number | string;
  width?: number;
  height?: number;
  opacity?: number;
  text?: string;
  fontSize?: number;
  fontColor?: string;
  speed?: number;
  imagePath?: string;
}
