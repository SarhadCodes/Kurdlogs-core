import dotenv from 'dotenv';
import path from 'path';

// Ensure .env is loaded
dotenv.config();

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3001', 10),
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/kurdlogs',
  JWT_SECRET: process.env.JWT_SECRET || 'kurdlogs-fallback-secret-do-not-use',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:8081,http://localhost',
  FFMPEG_PATH: process.env.FFMPEG_PATH || 'ffmpeg',
  STREAMS_DIR: process.env.STREAMS_DIR ? path.resolve(process.env.STREAMS_DIR) : path.resolve(__dirname, '../../../../streams'),
  UPLOADS_DIR: process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.resolve(__dirname, '../../../../uploads'),
  NGINX_HLS_URL: process.env.NGINX_HLS_URL || 'http://localhost:8080/hls',
  TOKEN_REFRESH_INTERVAL: parseInt(process.env.TOKEN_REFRESH_INTERVAL || '30', 10),
  /** API key for IPTV apps (header X-IPTV-Key or query api_key) */
  IPTV_API_KEY: process.env.IPTV_API_KEY || 'change-me-iptv-api-key',
  /** Public base URL used in IPTV API responses (no trailing slash) */
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || 'http://localhost').replace(/\/$/, ''),
  /** Host port for the web UI (docker maps HTTP_PORT→frontend:80) */
  HTTP_PORT: parseInt(process.env.HTTP_PORT || '8081', 10),
  /** Seconds the previous token stays valid after rotation */
  TOKEN_OVERLAP_SECONDS: parseInt(process.env.TOKEN_OVERLAP_SECONDS || '120', 10),
  /** Refresh this many seconds before expiry */
  TOKEN_REFRESH_AHEAD_SECONDS: parseInt(process.env.TOKEN_REFRESH_AHEAD_SECONDS || '90', 10),
  /**
   * Video encoder selection: auto | cpu | nvenc | qsv | vaapi
   * auto = use NVENC/QSV/VAAPI when FFmpeg reports them (GPU Docker image + drivers required for NVENC)
   */
  FFMPEG_ENCODER_MODE: (process.env.FFMPEG_ENCODER_MODE || 'auto').toLowerCase(),
  /** NVENC preset p1 (fastest) … p7 (best quality). p4 is a good live balance. */
  NVENC_PRESET: process.env.NVENC_PRESET || 'p4',
  /** Linux VAAPI render node when FFMPEG_ENCODER_MODE=vaapi */
  VAAPI_DEVICE: process.env.VAAPI_DEVICE || '/dev/dri/renderD128',
  /** Max playlist video upload size in MB (default 4GB). */
  MAX_UPLOAD_MB: parseInt(process.env.MAX_UPLOAD_MB || '4096', 10),
  /** Public RTMP publish port mapped from nginx-rtmp (1936 avoids Flussonic on 1935) */
  RTMP_PUBLISH_PORT: parseInt(process.env.RTMP_PUBLISH_PORT || '1936', 10),
  /** KurdLogs MCR RTMP port — must not be 1935 (Flussonic). All MCR URLs derive from this. */
  MCR_RTMP_PORT: parseInt(process.env.MCR_RTMP_PORT || process.env.RTMP_PUBLISH_PORT || '1936', 10),
  /** Shared secret for nginx RTMP on_publish callbacks */
  MCR_INGEST_SECRET: process.env.MCR_INGEST_SECRET || 'kurdlogs-mcr-ingest-secret',
  /** nginx-rtmp hostname inside Docker network */
  NGINX_RTMP_HOST: process.env.NGINX_RTMP_HOST || 'nginx-rtmp',
  /** RTMP application name on nginx-rtmp (must match nginx.conf rtmp application block) */
  MCR_RTMP_APP: process.env.MCR_RTMP_APP || 'live',
  /** Default MCR bus crossfade duration (ms) for FADE and AUTO transitions */
  MCR_FADE_DURATION_MS: parseInt(process.env.MCR_FADE_DURATION_MS || '500', 10),
  /** MCR architecture: v2-switcher (permanent encoder + ZMQ input select) or v1-bus (legacy RTMP relay) */
  MCR_ARCHITECTURE: (process.env.MCR_ARCHITECTURE || 'v2-switcher').toLowerCase(),
  /** libx264 preset for playlist normalization: ultrafast | superfast | veryfast */
  NORMALIZE_PRESET: process.env.NORMALIZE_PRESET || 'ultrafast',
};
