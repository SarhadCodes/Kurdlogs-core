/** Display-only helpers for blueprint schedule timestamps (no playback impact). */

export interface TimeDebugInfo {
  rawStartsAt: string;
  utcStartsAt: string;
  localStartsAt: string;
  displayedTime: string;
  timezoneOffsetMinutes: number;
  displayOffsetMs?: number;
}

export function formatTimelineClock(iso: string, displayOffsetMs = 0): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '--:--';
  const adjusted = new Date(ms + displayOffsetMs);
  return adjusted.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatTimelineDay(iso: string, displayOffsetMs = 0): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const adjusted = new Date(ms + displayOffsetMs);
  return adjusted.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function inspectScheduleTime(
  iso: string,
  displayOffsetMs = 0,
  displayedTime?: string
): TimeDebugInfo {
  const d = new Date(iso);
  const timezoneOffsetMinutes = -d.getTimezoneOffset();
  const shown = displayedTime ?? formatTimelineClock(iso, displayOffsetMs);
  return {
    rawStartsAt: iso,
    utcStartsAt: d.toISOString(),
    localStartsAt: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    displayedTime: shown,
    timezoneOffsetMinutes,
    displayOffsetMs,
  };
}

/** Align schedule labels to wall clock at the live row — display only. */
export function computeTimelineDisplayOffsetMs(
  liveStartsAt: string | undefined,
  wallNowIso: string | undefined
): number {
  if (!liveStartsAt || !wallNowIso) return 0;
  const liveMs = Date.parse(liveStartsAt);
  const wallMs = Date.parse(wallNowIso);
  if (!Number.isFinite(liveMs) || !Number.isFinite(wallMs)) return 0;
  return wallMs - liveMs;
}

export function logTimeDebug(
  label: string,
  iso: string,
  displayOffsetMs = 0,
  displayedTime?: string
): void {
  const info = inspectScheduleTime(iso, displayOffsetMs, displayedTime);
  console.info(
    `[TIME_DEBUG] ${label} rawStartsAt=${info.rawStartsAt} utcStartsAt=${info.utcStartsAt} ` +
      `localStartsAt=${info.localStartsAt} displayedTime=${info.displayedTime} ` +
      `timezoneOffsetMinutes=${info.timezoneOffsetMinutes} displayOffsetMs=${displayOffsetMs}`
  );
}
