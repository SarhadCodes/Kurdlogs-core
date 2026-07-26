import { Request } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { channelService } from '../services/channel.service';
import { tokenService } from '../services/token.service';
import { extractAuthToken } from './authCookie';
import type { TokenPayload } from '../types';

export interface StreamAccessResult {
  allowed: boolean;
  /** Legacy ?token= query propagation in playlists */
  appendQuery?: string;
  /** Token validated from /stream/:slug/t/:token/... path */
  tokenInPath?: string;
}

function verifyAdminSession(token: string): boolean {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    return payload.purpose !== 'mfa_pending' && Boolean(payload.userId);
  } catch {
    return false;
  }
}

export async function resolveStreamAccess(
  channelSlug: string,
  req: Request,
  options?: { pathToken?: string }
): Promise<StreamAccessResult> {
  // MCR session preview taps are internal slugs — not backed by Channel rows
  if (channelSlug.startsWith('mcr-sess-')) {
    return { allowed: true };
  }

  const channel = await channelService.getChannelBySlug(channelSlug);
  const protectedStream = await tokenService.hasActiveTokens(channel.id);

  if (!protectedStream) {
    return { allowed: true };
  }

  const pathToken = options?.pathToken?.trim();
  if (pathToken) {
    const valid = await tokenService.validateToken(channelSlug, pathToken);
    if (valid) {
      return { allowed: true, tokenInPath: pathToken };
    }
    return { allowed: false };
  }

  const streamToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  if (streamToken) {
    const valid = await tokenService.validateToken(channelSlug, streamToken);
    if (valid) {
      return {
        allowed: true,
        appendQuery: `token=${encodeURIComponent(streamToken)}`,
      };
    }
  }

  // Prefer httpOnly session cookie (no JWT echo into playlists / logs / Referer).
  const sessionToken = extractAuthToken(req);
  if (sessionToken && verifyAdminSession(sessionToken)) {
    return { allowed: true };
  }

  // Legacy query access_token — accepted but not rewritten into child URLs.
  const accessToken =
    typeof req.query.access_token === 'string' ? req.query.access_token : undefined;
  if (accessToken && verifyAdminSession(accessToken)) {
    return { allowed: true };
  }

  return { allowed: false };
}

export function rewriteHlsPlaylist(content: string, appendQuery: string): string {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;

      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        try {
          const url = new URL(trimmed);
          const extra = new URLSearchParams(appendQuery);
          extra.forEach((value, key) => url.searchParams.set(key, value));
          return url.toString();
        } catch {
          return line;
        }
      }

      const sep = trimmed.includes('?') ? '&' : '?';
      return `${trimmed}${sep}${appendQuery}`;
    })
    .join('\n');
}

function appendQueryToPath(urlOrPath: string, appendQuery: string): string {
  if (!urlOrPath) return urlOrPath;

  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
    try {
      const url = new URL(urlOrPath);
      const extra = new URLSearchParams(appendQuery);
      extra.forEach((value, key) => url.searchParams.set(key, value));
      return url.toString();
    } catch {
      return urlOrPath;
    }
  }

  const sep = urlOrPath.includes('?') ? '&' : '?';
  return `${urlOrPath}${sep}${appendQuery}`;
}

export function rewriteDashManifest(content: string, appendQuery: string): string {
  let result = content.replace(
    /(media|initialization|sourceURL|url|href)="([^"]+)"/gi,
    (_full, attr: string, value: string) => `${attr}="${appendQueryToPath(value, appendQuery)}"`
  );

  result = result.replace(
    /(media|initialization|sourceURL|url|href)='([^']+)'/gi,
    (_full, attr: string, value: string) => `${attr}='${appendQueryToPath(value, appendQuery)}'`
  );

  result = result.replace(
    /<BaseURL>([^<]+)<\/BaseURL>/gi,
    (_full, value: string) => `<BaseURL>${appendQueryToPath(value.trim(), appendQuery)}</BaseURL>`
  );

  return result;
}
