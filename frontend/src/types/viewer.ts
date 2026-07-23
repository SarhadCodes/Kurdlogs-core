export interface ViewerLocation {
  id: string;
  label: string;
  lat?: number;
  lng?: number;
  city?: string;
  country?: string;
  countryCode?: string;
  lastSeen: number;
  firstSeen: number;
  connectedSeconds: number;
  device?: string;
  player?: string;
  isp?: string;
  quality?: string;
  bitrateKbps?: number;
}

export interface ViewerMapPayload {
  channels: Record<string, ViewerLocation[]>;
}

export interface CobeMarker {
  id: string;
  location: [number, number];
  size: number;
  quality?: string;
}

/** Muted marker colors by stream quality (GitHub-style palette). */
export function qualityMarkerColor(quality?: string): string {
  if (!quality) return '#8b949e';
  const q = quality.toLowerCase();
  if (q.includes('1080')) return '#58a6ff';
  if (q.includes('720')) return '#3fb950';
  if (q.includes('480')) return '#d29922';
  if (q.includes('360')) return '#f85149';
  return '#a371f7';
}

export function qualityLabel(quality?: string): string {
  return quality || 'Auto';
}

export function formatViewerPlace(v: ViewerLocation): string {
  if (v.city === 'Local network') return 'Local network';
  if (v.city && v.country && v.country !== 'Local') return `${v.city}, ${v.country}`;
  if (v.city) return v.city;
  if (v.country) return v.country;
  return 'Unknown location';
}

export function formatViewerLocationLabel(v: ViewerLocation): string {
  if (v.city) return v.city;
  return formatViewerPlace(v);
}

export function formatConnectedDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

export function formatViewerBitrate(kbps?: number): string {
  if (!kbps || kbps <= 0) return '—';
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}

export function toCobeMarkers(
  locations: ViewerLocation[],
  selectedId?: string | null
): CobeMarker[] {
  return locations
    .filter((v) => v.lat != null && v.lng != null)
    .map((v) => ({
      id: v.id,
      location: [v.lat as number, v.lng as number],
      size: v.id === selectedId ? 14 : 9,
      quality: v.quality,
    }));
}

export const QUALITY_LEGEND = [
  { label: '1080p', color: qualityMarkerColor('1080p') },
  { label: '720p', color: qualityMarkerColor('720p') },
  { label: '480p', color: qualityMarkerColor('480p') },
  { label: 'Auto / other', color: qualityMarkerColor('Auto') },
] as const;
