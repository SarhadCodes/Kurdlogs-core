import { Request } from 'express';
import { env } from './env';

function normalizeOrigin(origin: string): string {
  try {
    const u = new URL(origin);
    return u.origin.replace(/\/$/, '');
  } catch {
    return origin.replace(/\/$/, '');
  }
}

function legacyPublicBaseUrl(): string {
  const fallback = `http://localhost:${env.HTTP_PORT || 8081}`;
  const raw = (env.PUBLIC_BASE_URL || fallback).replace(/\/$/, '');
  try {
    const u = new URL(raw);
    // HTTP_PORT is a legacy direct-port setting. Never append it to HTTPS
    // origins such as https://api.kurdlogs.com.
    if (u.protocol === 'http:' && !u.port && env.HTTP_PORT > 0 && env.HTTP_PORT !== 80) {
      u.port = String(env.HTTP_PORT);
    }
    return u.origin.replace(/\/$/, '');
  } catch {
    return raw;
  }
}

export function getAppBaseUrl(): string {
  return normalizeOrigin(env.KURDLOGS_APP_URL || legacyPublicBaseUrl());
}

export function getApiBaseUrl(): string {
  return normalizeOrigin(env.KURDLOGS_API_URL || legacyPublicBaseUrl());
}

export function getCdnBaseUrl(): string {
  return normalizeOrigin(env.KURDLOGS_CDN_URL || legacyPublicBaseUrl());
}

/** Full public delivery prefix, including /live for the dedicated CDN host. */
export function getPublicStreamBaseUrl(): string {
  const prefix = env.KURDLOGS_CDN_URL ? '/live' : '/stream';
  return `${getCdnBaseUrl()}${prefix}`;
}

/** Backwards-compatible canonical public API URL. */
export function getPublicBaseUrl(): string {
  return getApiBaseUrl();
}

/** Prefer the forwarded request origin, falling back to the configured API URL. */
export function resolveRequestBaseUrl(req: Request): string {
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const hostHeader = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();

  if (hostHeader) {
    return normalizeOrigin(`${proto}://${hostHeader}`);
  }

  return getApiBaseUrl();
}

export function publicHostFromBase(base: string): string {
  try {
    return new URL(base).hostname;
  } catch {
    return 'localhost';
  }
}
