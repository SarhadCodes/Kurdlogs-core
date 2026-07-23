import type { BlueprintBlock, BlueprintRuntimeState } from '../types/blueprint.types';
import { sequentialCursorKey } from './blueprintEngine.service';

/** Migrate per-block cursors (pre-v13.3.9) to per-playlist cursors. */
export function migrateCursorState(
  state: BlueprintRuntimeState,
  blocks: BlueprintBlock[]
): BlueprintRuntimeState {
  const sequentialCursors = { ...state.sequentialCursors };

  for (const block of blocks) {
    const oldKey = block.id;
    const newKey = sequentialCursorKey(block);
    if (oldKey in sequentialCursors) {
      const oldVal = sequentialCursors[oldKey];
      if (sequentialCursors[newKey] == null || sequentialCursors[newKey] < oldVal) {
        sequentialCursors[newKey] = oldVal;
      }
      delete sequentialCursors[oldKey];
    }
  }

  return { ...state, sequentialCursors };
}
