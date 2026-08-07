import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function requireJwtSecret(): string {
  const secret = (process.env.JWT_SECRET || '').trim();
  if (!secret) {
    throw new Error(
      'JWT_SECRET is required. Set a strong random secret in the environment (do not use defaults).'
    );
  }
  const weak = new Set([
    'kurdlogs-fallback-secret-do-not-use',
    'change-me-jwt-secret',
    'change-me-long-random-secret',
    'your-super-secret-jwt-key-change-this',
    'local-dev-jwt-secret-change-me',
  ]);
  if (weak.has(secret) || secret.length < 32) {
    throw new Error(
      'JWT_SECRET is too weak. Use a random secret of at least 32 characters (install scripts generate one).'
    );
  }
  return secret;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3001', 10),
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/kurdlogs',
  JWT_SECRET: requireJwtSecret(),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME || 'kl_session',
  /** Set COOKIE_SECURE=true behind HTTPS. Defaults false so local HTTP Docker works. */
  COOKIE_SECURE: process.env.COOKIE_SECURE === 'true',
  MFA_ISSUER: process.env.MFA_ISSUER || 'KurdLogs Core',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:8081,http://localhost',
  FFMPEG_PATH: process.env.FFMPEG_PATH || 'ffmpeg',
  STREAMS_DIR: process.env.STREAMS_DIR ? path.resolve(process.env.STREAMS_DIR) : path.resolve(__dirname, '../../../../streams'),
  UPLOADS_DIR: process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.resolve(__dirname, '../../../../uploads'),
  NGINX_HLS_URL: process.env.NGINX_HLS_URL || 'http://localhost:8080/hls',
  TOKEN_REFRESH_INTERVAL: parseInt(process.env.TOKEN_REFRESH_INTERVAL || '30', 10),
  IPTV_API_KEY: process.env.IPTV_API_KEY || 'change-me-iptv-api-key',
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || 'http://localhost').replace(/\/$/, ''),
  KURDLOGS_PUBLIC_SITE_URL: (process.env.KURDLOGS_PUBLIC_SITE_URL || '').replace(/\/$/, ''),
  KURDLOGS_APP_URL: (process.env.KURDLOGS_APP_URL || '').replace(/\/$/, ''),
  KURDLOGS_API_URL: (process.env.KURDLOGS_API_URL || '').replace(/\/$/, ''),
  KURDLOGS_CDN_URL: (process.env.KURDLOGS_CDN_URL || '').replace(/\/$/, ''),
  HTTP_PORT: parseInt(process.env.HTTP_PORT || '8081', 10),
  TOKEN_OVERLAP_SECONDS: parseInt(process.env.TOKEN_OVERLAP_SECONDS || '120', 10),
  TOKEN_REFRESH_AHEAD_SECONDS: parseInt(process.env.TOKEN_REFRESH_AHEAD_SECONDS || '90', 10),
  FFMPEG_ENCODER_MODE: (process.env.FFMPEG_ENCODER_MODE || 'auto').toLowerCase(),
  NVENC_PRESET: process.env.NVENC_PRESET || 'p4',
  VAAPI_DEVICE: process.env.VAAPI_DEVICE || '/dev/dri/renderD128',
  /** Max playlist video upload size in MB (default 4GB, aligned with nginx). */
  MAX_UPLOAD_MB: parseInt(process.env.MAX_UPLOAD_MB || '4096', 10),
  RTMP_PUBLISH_PORT: parseInt(process.env.RTMP_PUBLISH_PORT || '1936', 10),
  MCR_RTMP_PORT: parseInt(process.env.MCR_RTMP_PORT || process.env.RTMP_PUBLISH_PORT || '1936', 10),
  MCR_INGEST_SECRET: process.env.MCR_INGEST_SECRET || 'kurdlogs-mcr-ingest-secret',
  NGINX_RTMP_HOST: process.env.NGINX_RTMP_HOST || 'nginx-rtmp',
  MCR_RTMP_APP: process.env.MCR_RTMP_APP || 'live',
  MCR_FADE_DURATION_MS: parseInt(process.env.MCR_FADE_DURATION_MS || '500', 10),
  MCR_ARCHITECTURE: (process.env.MCR_ARCHITECTURE || 'v2-switcher').toLowerCase(),
  NORMALIZE_PRESET: process.env.NORMALIZE_PRESET || 'ultrafast',
  GRAPHICS_ENGINE_ENABLED: process.env.GRAPHICS_ENGINE_ENABLED === 'true',
  GRAPHICS_MAX_ASSET_MB: parseInt(process.env.GRAPHICS_MAX_ASSET_MB || '10', 10),
};
