/** Public HLS/DASH — streamBase includes /stream (legacy) or /live (CDN). */
export function buildPublicStreamUrl(streamBase: string, slug: string, file: string): string {
  return `${streamBase}/${slug}/${file}`;
}

/** Token is in the path (not ?token= after .m3u8). */
export function buildTokenStreamUrl(streamBase: string, slug: string, token: string, file: string): string {
  return `${streamBase}/${slug}/t/${encodeURIComponent(token)}/${file}`;
}

export function buildStablePlayUrl(streamBase: string, slug: string, file: string, apiKey: string): string {
  return `${streamBase}/play/${slug}/${file}?api_key=${encodeURIComponent(apiKey)}`;
}
