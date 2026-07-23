import { createHash } from 'crypto';
import type { Request } from 'express';
import { getRequestClientIp } from './clientIp';

const VSID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function fingerprintViewerId(slug: string, ip: string, userAgent: string): string {
  const digest = createHash('sha256')
    .update(`${slug}|${ip}|${userAgent}`)
    .digest('hex')
    .slice(0, 20);
  return `fp:${digest}`;
}

/** Stable viewer id for HLS clients — query param, cookie, or IP+UA fingerprint. */
export function resolveStreamViewerId(req: Request, slug: string): string {
  const queryVsid = typeof req.query.vsid === 'string' ? req.query.vsid.trim() : '';
  if (queryVsid && VSID_RE.test(queryVsid)) {
    return queryVsid;
  }

  const cookieVsid = parseCookieHeader(req.headers.cookie).kl_viewer;
  if (cookieVsid && VSID_RE.test(cookieVsid)) {
    return cookieVsid;
  }

  const ip = getRequestClientIp(req);
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';
  return fingerprintViewerId(slug, ip, userAgent);
}

export function viewerSessionQueryParam(viewerId: string): string {
  return `vsid=${encodeURIComponent(viewerId)}`;
}
