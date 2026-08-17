type KurdLogsRuntimeConfig = {
  publicSiteUrl?: string;
  appUrl?: string;
  apiUrl?: string;
  cdnUrl?: string;
};

declare global {
  interface Window {
    __KURDLOGS_CONFIG__?: KurdLogsRuntimeConfig;
  }
}

function origin(value?: string): string {
  const trimmed = value?.trim().replace(/\/$/, '') || '';
  if (!trimmed) return '';
  try {
    return new URL(trimmed).origin;
  } catch {
    return '';
  }
}

const configured = typeof window !== 'undefined' ? window.__KURDLOGS_CONFIG__ || {} : {};

export const runtimeConfig = Object.freeze({
  publicSiteUrl: origin(configured.publicSiteUrl),
  appUrl: origin(configured.appUrl),
  apiUrl: origin(configured.apiUrl),
  cdnUrl: origin(configured.cdnUrl),
});

export function getAppOrigin(): string {
  return runtimeConfig.appUrl || (typeof window !== 'undefined' ? window.location.origin : '');
}

export function getApiOrigin(): string {
  return runtimeConfig.apiUrl || (typeof window !== 'undefined' ? window.location.origin : '');
}

export function getApiBaseUrl(): string {
  const base = getApiOrigin();
  return base ? `${base}/api` : '/api';
}

export function getSocketOrigin(): string {
  return getApiOrigin() || '/';
}

export function getCdnOrigin(): string {
  return runtimeConfig.cdnUrl || (typeof window !== 'undefined' ? window.location.origin : '');
}

export function getPublicStreamBaseUrl(): string {
  const base = getCdnOrigin();
  const prefix = runtimeConfig.cdnUrl ? '/live' : '/stream';
  return `${base}${prefix}`;
}

export function getAdminStreamBaseUrl(): string {
  return `${getApiOrigin()}/stream`;
}

export function isApiRequestUrl(value: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const target = new URL(value, window.location.origin);
    return target.origin === getApiOrigin();
  } catch {
    return false;
  }
}

export function resolvePublicUploadUrl(value: string): string {
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) return value;
  const normalized = value.replace(/\\/g, '/');
  const marker = normalized.lastIndexOf('/uploads/');
  const path = marker >= 0
    ? normalized.slice(marker)
    : `/${normalized.replace(/^\/+/, '').replace(/^uploads\//, 'uploads/')}`;
  const uploadPath = path.startsWith('/uploads/') ? path : `/uploads/${path.replace(/^\/+/, '')}`;
  return `${getApiOrigin()}${uploadPath}`;
}

export {};
