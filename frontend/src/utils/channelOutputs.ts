import { Channel, Token } from '../types';
import { buildTokenStreamUrl } from './streamUrl';

/** Fallback when play-urls API has not loaded — preserve non-default port (e.g. :8081). */
function defaultOutputBase(): string {
  if (typeof window === 'undefined') return '';
  const { protocol, hostname, port } = window.location;
  if (port) return `${protocol}//${hostname}:${port}`;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return `${protocol}//${hostname}:8081`;
  return `${protocol}//${hostname}`;
}

export type OutputAuthType = 'none' | 'token' | 'admin' | 'api_key';

export interface ChannelOutputEntry {
  id: string;
  protocol: string;
  title: string;
  description: string;
  url: string;
  embedCode?: string;
  authType: OutputAuthType;
  recommended?: boolean;
}

export interface ChannelOutputSection {
  id: string;
  title: string;
  description: string;
  warning?: string;
  highlight?: boolean;
  entries: ChannelOutputEntry[];
}

export interface ChannelPlayUrlsData {
  baseUrl: string;
  slug: string;
  status: string;
  tokenProtected: boolean;
  /** False when no fresh HLS segments on disk (links will 404 until channel is started). */
  streamReady?: boolean;
  hlsManifest?: string;
  vlcHint?: string;
  urls: {
    publicHls: string;
    publicDash: string;
    hlsWithToken: string | null;
    dashWithToken: string | null;
    stableHls: string | null;
    stableDash: string | null;
  };
  ingest?: {
    serverUrl: string;
    streamKey: string;
    publishUrl: string;
    internalSourceUrl: string;
    publishPort?: number;
  };
}

function adminSessionUrlsEnabled(): boolean {
  return typeof window !== 'undefined';
}

function embedUrl(base: string, slug: string, query?: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value) params.set(key, value);
    }
  }
  const q = params.toString();
  return `${base}/embed/${slug}${q ? `?${q}` : ''}`;
}

function iframeFor(url: string): string {
  return `<iframe src="${url}" width="640" height="360" frameborder="0" allowfullscreen></iframe>`;
}

export function buildChannelOutputSections(
  channel: Channel,
  activeToken?: Token | null,
  playUrls?: ChannelPlayUrlsData | null
): ChannelOutputSection[] {
  const base = playUrls?.baseUrl || defaultOutputBase();
  const { slug } = channel;
  const tokenValue = activeToken?.token;
  const tokenProtected = playUrls?.tokenProtected ?? !!activeToken;
  // The server emits one delivery format per channel.  Do not present DASH
  // URLs for an HLS channel: a manifest.mpd does not exist in that output and
  // VLC/browser clients correctly reject the resulting 404.
  const supportsDash = channel.outputType === 'DASH';

  const publicHls = playUrls?.urls.publicHls ?? `${base}/stream/${slug}/master.m3u8`;
  const publicDash = supportsDash
    ? (playUrls?.urls.publicDash ?? `${base}/stream/${slug}/manifest.mpd`)
    : null;
  const tokenHls =
    playUrls?.urls.hlsWithToken ??
    (tokenValue ? buildTokenStreamUrl(base, slug, tokenValue, 'master.m3u8') : null);
  const tokenDash = supportsDash
    ? (playUrls?.urls.dashWithToken ??
      (tokenValue ? buildTokenStreamUrl(base, slug, tokenValue, 'manifest.mpd') : null))
    : null;
  const stableHls = playUrls?.urls.stableHls;
  const stableDash = supportsDash ? playUrls?.urls.stableDash : null;

  const sections: ChannelOutputSection[] = [];

  // ── VLC / external players (recommended) ────────────────────
  const vlcEntries: ChannelOutputEntry[] = [];

  if (tokenProtected && tokenHls) {
    vlcEntries.push({
      id: 'vlc-hls-token',
      protocol: 'HLS',
      title: 'HLS for VLC (with token)',
      description: 'Recommended — paste in VLC: Media → Open Network Stream',
      url: tokenHls,
      authType: 'token',
      recommended: true,
    });
  } else if (!tokenProtected) {
    vlcEntries.push({
      id: 'vlc-hls-public',
      protocol: 'HLS',
      title: 'HLS for VLC',
      description: 'Paste in VLC: Media → Open Network Stream',
      url: publicHls,
      authType: 'none',
      recommended: true,
    });
  }

  if (stableHls) {
    vlcEntries.push({
      id: 'vlc-stable-hls',
      protocol: 'IPTV',
      title: 'IPTV stable HLS (for VLC)',
      description: 'Fixed URL — token refreshes automatically; best for long playlists',
      url: stableHls,
      authType: 'api_key',
      recommended: !tokenHls,
    });
  }

  if (vlcEntries.length > 0) {
    sections.push({
      id: 'vlc',
      title: 'VLC & external players',
      description: playUrls?.vlcHint || 'Use HLS (.m3u8). DASH support in VLC is limited.',
      highlight: true,
      warning:
        channel.status !== 'ONLINE'
          ? 'Channel is offline — start the channel before opening in VLC.'
          : undefined,
      entries: vlcEntries,
    });
  }

  // ── With stream token ───────────────────────────────────────
  const tokenEntries: ChannelOutputEntry[] = [];
  if (tokenHls) {
    tokenEntries.push(
      {
        id: 'token-hls',
        protocol: 'TOKEN',
        title: 'HLS',
        description: 'Signed HLS — token in path (/t/TOKEN/)',
        url: tokenHls,
        authType: 'token',
      },
      ...(tokenDash
        ? [
            {
              id: 'token-dash',
              protocol: 'TOKEN',
              title: 'DASH',
              description: 'Signed DASH — token in path (/t/TOKEN/)',
              url: tokenDash,
              authType: 'token' as const,
            },
          ]
        : []),
      {
        id: 'token-embed',
        protocol: 'TOKEN',
        title: 'Embed player',
        description: 'Iframe with stream token in URL',
        url: embedUrl(base, slug, { token: tokenValue! }),
        embedCode: iframeFor(embedUrl(base, slug, { token: tokenValue! })),
        authType: 'token',
      }
    );
  }

  sections.push({
    id: 'with-token',
    title: 'With stream token',
    description: tokenHls
      ? 'Uses the active token for this channel. Token rotates on your schedule.'
      : 'Create and activate a stream token on the Tokens page to generate these URLs.',
    warning: !tokenHls ? 'No active token for this channel.' : undefined,
    entries: tokenEntries,
  });

  // ── Without token — only when channel is not token-protected ─
  if (!tokenProtected) {
    sections.push({
      id: 'no-token',
      title: 'Without token (public)',
      description: 'Open URLs — no stream token required. Not available while a token is active on this channel.',
      entries: [
        {
          id: 'public-hls',
          protocol: 'HLS',
          title: 'HLS',
          description: 'master.m3u8 (adaptive)',
          url: publicHls,
          authType: 'none',
        },
        ...(publicDash
          ? [
              {
                id: 'public-dash',
                protocol: 'DASH',
                title: 'DASH',
                description: 'manifest.mpd',
                url: publicDash,
                authType: 'none' as const,
              },
            ]
          : []),
        {
          id: 'public-embed',
          protocol: 'EMBED',
          title: 'Embed player',
          description: 'Iframe without authentication',
          url: embedUrl(base, slug),
          embedCode: iframeFor(embedUrl(base, slug)),
          authType: 'none',
        },
      ],
    });
  }

  // ── Admin session (httpOnly cookie; same browser only) ──────
  if (adminSessionUrlsEnabled()) {
    const adminHls = `${base}/stream/${slug}/master.m3u8`;
    const adminDash = `${base}/stream/${slug}/manifest.mpd`;
    const adminEmbed = embedUrl(base, slug);

    sections.push({
      id: 'admin',
      title: 'Admin (browser session)',
      description: 'Uses your httpOnly session cookie — works in this browser only; do not share.',
      entries: [
        {
          id: 'admin-hls',
          protocol: 'HLS',
          title: 'HLS',
          description: 'master.m3u8 (session cookie)',
          url: adminHls,
          authType: 'admin',
        },
        ...(supportsDash
          ? [
              {
                id: 'admin-dash',
                protocol: 'DASH',
                title: 'DASH',
                description: 'manifest.mpd (session cookie)',
                url: adminDash,
                authType: 'admin' as const,
              },
            ]
          : []),
        {
          id: 'admin-embed',
          protocol: 'EMBED',
          title: 'Embed player',
          description: 'Iframe in this browser session',
          url: adminEmbed,
          embedCode: iframeFor(adminEmbed),
          authType: 'admin',
        },
      ],
    });
  }

  // ── IPTV stable ─────────────────────────────────────────────
  if (stableHls || stableDash) {
    sections.push({
      id: 'iptv',
      title: 'IPTV stable URL',
      description: 'Fixed URL; api_key injects the latest stream token on each request.',
      entries: [
        ...(stableHls
          ? [
              {
                id: 'stable-hls',
                protocol: 'IPTV',
                title: 'IPTV stable HLS',
                description: 'For VLC, set-top boxes, and IPTV apps',
                url: stableHls,
                authType: 'api_key' as const,
              },
            ]
          : []),
        ...(stableDash
          ? [
              {
                id: 'stable-dash',
                protocol: 'IPTV',
                title: 'IPTV stable DASH',
                description: 'Stable DASH play URL',
                url: stableDash,
                authType: 'api_key' as const,
              },
            ]
          : []),
        {
          id: 'iptv-embed',
          protocol: 'EMBED',
          title: 'Embed (IPTV API key)',
          description: 'Uses api_key from server config',
          url: stableHls
            ? embedUrl(base, slug, {
                api_key: new URL(stableHls).searchParams.get('api_key') || 'YOUR_IPTV_API_KEY',
              })
            : embedUrl(base, slug, { api_key: 'YOUR_IPTV_API_KEY' }),
          embedCode: stableHls
            ? iframeFor(
                embedUrl(base, slug, {
                  api_key: new URL(stableHls).searchParams.get('api_key') || '',
                })
              )
            : undefined,
          authType: 'api_key',
        },
      ],
    });
  }

  const ingest = playUrls?.ingest;
  const host = typeof window !== 'undefined' ? new URL(base).hostname : 'localhost';
  const rtmpPort = ingest?.publishPort ?? 1936;
  const ingestServer = ingest?.serverUrl || `rtmp://${host}:${rtmpPort}/live`;
  const ingestKey = ingest?.streamKey || slug;
  const ingestPublish = ingest?.publishUrl || `${ingestServer}/${ingestKey}`;
  const ingestInternal = ingest?.internalSourceUrl || `rtmp://nginx-rtmp:1936/live/${slug}`;
  sections.push({
    id: 'ingest',
    title: 'OBS / Ingest',
    description: 'Push stream from OBS, vMix, or other encoders into this KurdLogs channel.',
    warning:
      rtmpPort !== 1935
        ? `Use port ${rtmpPort} for KurdLogs ingest — port 1935 on this server is usually Flussonic, not KurdLogs.`
        : undefined,
    entries: [
      {
        id: 'rtmp-server',
        protocol: 'RTMP',
        title: 'Server URL (OBS)',
        description: 'OBS Settings > Stream > Server',
        url: ingestServer,
        authType: 'none',
      },
      {
        id: 'rtmp-key',
        protocol: 'RTMP',
        title: 'Stream key (OBS)',
        description: 'OBS Settings > Stream > Stream Key',
        url: ingestKey,
        authType: 'none',
      },
      {
        id: 'rtmp-publish-full',
        protocol: 'RTMP',
        title: 'Full publish URL',
        description: 'For encoders that use a single RTMP URL field',
        url: ingestPublish,
        authType: 'none',
      },
      {
        id: 'rtmp-internal-source',
        protocol: 'RTMP',
        title: 'Channel source URL (internal)',
        description: 'Set this as channel sourceUrl for RTMP ingest mode',
        url: ingestInternal,
        authType: 'none',
      },
    ],
  });

  return sections;
}

/** @deprecated Use buildChannelOutputSections */
export function buildChannelOutputs(
  channel: Channel,
  activeToken?: Token | null,
  playUrls?: ChannelPlayUrlsData | null
): ChannelOutputEntry[] {
  return buildChannelOutputSections(channel, activeToken, playUrls).flatMap((s) => s.entries);
}
