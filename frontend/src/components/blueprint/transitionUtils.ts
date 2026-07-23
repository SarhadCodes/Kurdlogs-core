import type { BlueprintBlock, BlueprintBlockType } from '../../types';

export function transitionLabel(block: BlueprintBlock, prevType?: BlueprintBlockType): string {
  const t = block.config.transitionIn;
  if (!t || t.mode === 'ALWAYS') return 'Always';

  const after = t.afterBlockType || prevType;
  const typeName = after ? after.replace(/_/g, ' ').toLowerCase() : 'item';

  if (t.mode === 'EVERY_N_ITEMS') {
    const n = t.value ?? 1;
    return `Every ${n} ${typeName}${n > 1 ? 's' : ''}`;
  }

  if (t.mode === 'EVERY_N_MINUTES') {
    const n = t.value ?? 1;
    return `Every ${n} min`;
  }

  return 'Always';
}

export function defaultTransitionAfter(blocks: BlueprintBlock[], index: number): BlueprintBlockType | undefined {
  for (let i = index - 1; i >= 0; i--) {
    if (blocks[i].type !== 'LOOP') return blocks[i].type;
  }
  return undefined;
}
