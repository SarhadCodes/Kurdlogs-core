export interface ViewerStreamMeta {
  quality?: string;
  bitrateKbps?: number;
  player?: string;
}

let streamMeta: ViewerStreamMeta = {};

const VIEWER_SESSION_KEY = 'kl_viewer_id';

export function getOrCreateViewerSessionId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = sessionStorage.getItem(VIEWER_SESSION_KEY);
    if (existing && existing.length >= 8) return existing;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().replace(/-/g, '')
        : `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(VIEWER_SESSION_KEY, id);
    return id;
  } catch {
    return `v${Date.now().toString(36)}`;
  }
}

export function setViewerStreamMeta(meta: ViewerStreamMeta) {
  streamMeta = { ...streamMeta, ...meta };
}

export function getViewerStreamMeta(): ViewerStreamMeta {
  return streamMeta;
}
