/** Public HLS/DASH — no stream token in URL. */
export function buildPublicStreamUrl(base: string, slug: string, file: string): string {
  return `${base}/stream/${slug}/${file}`;
}

/** Token is in the path (not ?token= after .m3u8). */
export function buildTokenStreamUrl(base: string, slug: string, token: string, file: string): string {
  return `${base}/stream/${slug}/t/${encodeURIComponent(token)}/${file}`;
}

export function buildStablePlayUrl(base: string, slug: string, file: string, apiKey: string): string {
  return `${base}/stream/play/${slug}/${file}?api_key=${encodeURIComponent(apiKey)}`;
}
