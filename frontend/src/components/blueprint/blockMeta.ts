import type { BlueprintBlockType } from '../../types';
import { generateId } from '../../utils/id';

export const BLOCK_PALETTE: Array<{
  type: BlueprintBlockType;
  label: string;
  color: string;
  description: string;
}> = [
  { type: 'INTRO', label: 'Intro', color: 'border-violet-500/50 bg-violet-950/40', description: 'Channel opening' },
  { type: 'MOVIE', label: 'Movie', color: 'border-blue-500/50 bg-blue-950/40', description: 'Feature content' },
  { type: 'PROMO', label: 'Promo', color: 'border-amber-500/50 bg-amber-950/40', description: 'Promotional clip' },
  { type: 'STATION_ID', label: 'Station ID', color: 'border-emerald-500/50 bg-emerald-950/40', description: 'Brand bumper' },
  { type: 'MUSIC', label: 'Music', color: 'border-pink-500/50 bg-pink-950/40', description: 'Music video block' },
  { type: 'SUPER', label: 'Super', color: 'border-orange-500/50 bg-orange-950/40', description: 'Multiple videos from one playlist' },
  { type: 'CARTOON', label: 'Cartoon', color: 'border-cyan-500/50 bg-cyan-950/40', description: 'Kids animation' },
  { type: 'SCHEDULE', label: 'Schedule', color: 'border-gray-500/50 bg-gray-900/40', description: 'Time-based (future)' },
  { type: 'LOOP', label: 'Loop', color: 'border-white/30 bg-[#1a1a1a]', description: 'Repeat from start' },
];

export function blockMeta(type: BlueprintBlockType) {
  return BLOCK_PALETTE.find((b) => b.type === type) || BLOCK_PALETTE[0];
}

export function newBlock(type: BlueprintBlockType, label?: string) {
  const base = {
    id: generateId(),
    type,
    label: label || blockMeta(type).label,
    config: {
      selectionMode: type === 'LOOP' ? undefined : ('SEQUENTIAL' as const),
      repeatCount: type === 'SUPER' ? 5 : 1,
      ...(type === 'SUPER' ? { superPlayMode: 'COUNT' as const } : {}),
    },
  };
  return base;
}
