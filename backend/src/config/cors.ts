/** Comma-separated CORS_ORIGIN env → trimmed origin list. */
export function parseCorsOrigins(raw: string | undefined, fallback = 'http://localhost:8081'): string[] {
  const value = raw?.trim() || fallback;
  const origins = value
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return [...new Set(origins)];
}

export function corsOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  const normalized = origin.replace(/\/$/, '');
  if (allowed.includes(normalized)) return true;
  try {
    const host = new URL(normalized).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return true;
  } catch {
    /* ignore malformed origin */
  }
  return false;
}
