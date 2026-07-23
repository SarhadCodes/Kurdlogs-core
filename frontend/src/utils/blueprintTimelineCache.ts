import type { BlueprintSimulation, SimulationHorizon } from '../types';

const PREFIX = 'kurdlogs:timeline:';

function cacheKey(blueprintId: string, horizon: SimulationHorizon) {
  return `${PREFIX}${blueprintId}:${horizon}`;
}

export function saveTimelineToStorage(
  blueprintId: string,
  horizon: SimulationHorizon,
  data: BlueprintSimulation
): void {
  try {
    localStorage.setItem(
      cacheKey(blueprintId, horizon),
      JSON.stringify({
        savedAt: new Date().toISOString(),
        playbackEpoch: data.playbackEpoch ?? 0,
        data,
      })
    );
  } catch {
    /* quota or private mode */
  }
}

export function loadTimelineFromStorage(
  blueprintId: string,
  horizon: SimulationHorizon,
  blueprintUpdatedAt?: string,
  requiredPlaybackEpoch?: number
): BlueprintSimulation | null {
  try {
    const raw = localStorage.getItem(cacheKey(blueprintId, horizon));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      savedAt: string;
      playbackEpoch?: number;
      data: BlueprintSimulation;
    };
    if (blueprintUpdatedAt && parsed.data.blueprintUpdatedAt !== blueprintUpdatedAt) return null;
    if (
      requiredPlaybackEpoch != null &&
      (parsed.playbackEpoch ?? parsed.data.playbackEpoch ?? 0) !== requiredPlaybackEpoch
    ) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function clearTimelineStorage(blueprintId: string): void {
  try {
    for (const h of ['1h', '24h', '7d'] as SimulationHorizon[]) {
      localStorage.removeItem(cacheKey(blueprintId, h));
    }
  } catch {
    /* ignore */
  }
}
