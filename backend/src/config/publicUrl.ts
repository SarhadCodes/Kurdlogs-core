import { Request } from 'express';
import { env } from './env';

function withHttpPort(origin: string, port: number): string {
  try {
    const u = new URL(origin);
    if (!u.port && port > 0 && port !== 80 && port !== 443) {
      u.port = String(port);
    }
    return u.origin.replace(/\/$/, '');
  } catch {
    return origin.replace(/\/$/, '');
  }
}

/** Canonical public site URL — ensures HTTP_PORT when PUBLIC_BASE_URL omits it. */
export function getPublicBaseUrl(): string {
  const fallback = `http://localhost:${env.HTTP_PORT || 8081}`;
  const raw = (env.PUBLIC_BASE_URL || fallback).replace(/\/$/, '');
  const port = env.HTTP_PORT || 8081;
  return withHttpPort(raw, port);
}

/** Prefer request Host (for VLC on same machine), but keep port when proxy strips it. */
export function resolveRequestBaseUrl(req: Request): string {
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const hostHeader = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  const port = env.HTTP_PORT || 8081;

  if (hostHeader) {
    const base = hostHeader.includes(':') ? `${proto}://${hostHeader}` : `${proto}://${hostHeader}:${port}`;
    return withHttpPort(base, port);
  }

  return getPublicBaseUrl();
}

export function publicHostFromBase(base: string): string {
  try {
    return new URL(base).hostname;
  } catch {
    return 'localhost';
  }
}
