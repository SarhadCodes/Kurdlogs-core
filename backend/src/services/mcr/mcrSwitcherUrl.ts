/** Internal marker — program encoder reads from the v2 switcher, not RTMP bus. */
export function buildMcrSwitcherSourceUrl(channelId: string): string {
  return `mcr-switcher://program/${channelId}`;
}

export function isMcrSwitcherSourceUrl(sourceUrl: string | null | undefined): boolean {
  return typeof sourceUrl === 'string' && sourceUrl.startsWith('mcr-switcher://program/');
}

export function parseMcrSwitcherChannelId(sourceUrl: string): string | null {
  const m = sourceUrl.match(/^mcr-switcher:\/\/program\/([0-9a-f-]+)$/i);
  return m?.[1] ?? null;
}
