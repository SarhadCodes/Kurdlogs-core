import type { BlueprintLiveCursor, BlueprintSimulation } from '../types';

/**
 * NOW marker — server timelineIndex only (blockId + itemId + occurrenceIndex).
 * No client-side time or title matching.
 */
export function resolveLiveSegmentIndex(
  segments: BlueprintSimulation['segments'],
  cursor: BlueprintLiveCursor | null
): number | null {
  if (!segments.length || !cursor) return null;

  if (cursor.timelineIndex != null && cursor.timelineIndex >= 0) {
    return cursor.timelineIndex;
  }

  const active = cursor.current ?? cursor.visible ?? cursor.engine;
  if (!active?.itemId || active.occurrenceIndex == null) return null;

  const exact = segments.findIndex(
    (s) =>
      s.blockId === active.blockId &&
      s.itemId === active.itemId &&
      s.occurrenceIndex === active.occurrenceIndex
  );
  return exact >= 0 ? exact : null;
}
