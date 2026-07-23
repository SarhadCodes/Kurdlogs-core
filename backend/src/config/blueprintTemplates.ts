import type { BlueprintBlock } from '../types/blueprint.types';
import { v4 as uuidv4 } from 'uuid';

export interface BlueprintTemplate {
  key: string;
  name: string;
  description: string;
  blocks: Omit<BlueprintBlock, 'id'>[];
}

function block(type: BlueprintBlock['type'], label: string, config: BlueprintBlock['config'] = {}): Omit<BlueprintBlock, 'id'> {
  return { type, label, config: { selectionMode: 'SEQUENTIAL', repeatCount: 1, ...config } };
}

export const BLUEPRINT_TEMPLATES: BlueprintTemplate[] = [
  {
    key: 'movie-channel',
    name: 'Movie Channel',
    description: 'Intro → Movie → Promo → Movie → Station ID → Loop',
    blocks: [
      block('INTRO', 'Intro', { selectionMode: 'SEQUENTIAL' }),
      block('MOVIE', 'Movie', { selectionMode: 'RANDOM' }),
      block('PROMO', 'Promo', { selectionMode: 'RANDOM' }),
      block('MOVIE', 'Movie', { selectionMode: 'RANDOM' }),
      block('STATION_ID', 'Station ID', { selectionMode: 'SEQUENTIAL' }),
      block('LOOP', 'Loop'),
    ],
  },
  {
    key: 'music-channel',
    name: 'Music Channel',
    description: 'Intro → Music Video → Music Video → Promo → Station ID → Loop',
    blocks: [
      block('INTRO', 'Intro', { selectionMode: 'SEQUENTIAL' }),
      block('MUSIC', 'Music Video', { selectionMode: 'RANDOM' }),
      block('MUSIC', 'Music Video', { selectionMode: 'RANDOM' }),
      block('PROMO', 'Promo', { selectionMode: 'RANDOM' }),
      block('STATION_ID', 'Station ID', { selectionMode: 'SEQUENTIAL' }),
      block('LOOP', 'Loop'),
    ],
  },
  {
    key: 'kids-channel',
    name: 'Kids Channel',
    description: 'Intro → Cartoon → Promo → Educational → Station ID → Loop',
    blocks: [
      block('INTRO', 'Intro', { selectionMode: 'SEQUENTIAL' }),
      block('CARTOON', 'Cartoon', { selectionMode: 'RANDOM' }),
      block('PROMO', 'Promo', { selectionMode: 'RANDOM' }),
      block('MOVIE', 'Educational Content', { selectionMode: 'SEQUENTIAL' }),
      block('STATION_ID', 'Station ID', { selectionMode: 'SEQUENTIAL' }),
      block('LOOP', 'Loop'),
    ],
  },
  {
    key: '24-7-cinema',
    name: '24/7 Cinema',
    description: 'Non-stop movies with promos every 2 features',
    blocks: [
      block('INTRO', 'Channel Open', { selectionMode: 'SEQUENTIAL' }),
      block('MOVIE', 'Feature Film', { selectionMode: 'SEQUENTIAL' }),
      block('MOVIE', 'Feature Film', { selectionMode: 'SEQUENTIAL' }),
      block('PROMO', 'Promo Break', { selectionMode: 'SEQUENTIAL', transitionIn: { mode: 'EVERY_N_ITEMS', value: 2, afterBlockType: 'MOVIE' } }),
      block('STATION_ID', 'Station ID', { selectionMode: 'SEQUENTIAL' }),
      block('LOOP', 'Loop'),
    ],
  },
  {
    key: 'weekend-cinema',
    name: 'Weekend Cinema',
    description: 'Double features with station IDs — great for Fri–Sun',
    blocks: [
      block('INTRO', 'Weekend Intro', { selectionMode: 'SEQUENTIAL' }),
      block('MOVIE', 'Movie 1', { selectionMode: 'RANDOM' }),
      block('PROMO', 'Promo', { selectionMode: 'RANDOM' }),
      block('MOVIE', 'Movie 2', { selectionMode: 'RANDOM' }),
      block('STATION_ID', 'Station ID', { selectionMode: 'SEQUENTIAL' }),
      block('LOOP', 'Loop'),
    ],
  },
  {
    key: 'music-hits',
    name: 'Music Hits',
    description: 'Back-to-back hits with frequent promos',
    blocks: [
      block('INTRO', 'Intro', { selectionMode: 'SEQUENTIAL' }),
      block('MUSIC', 'Hit Video', { selectionMode: 'RANDOM' }),
      block('MUSIC', 'Hit Video', { selectionMode: 'RANDOM' }),
      block('MUSIC', 'Hit Video', { selectionMode: 'RANDOM' }),
      block('PROMO', 'Promo', { selectionMode: 'RANDOM' }),
      block('STATION_ID', 'Station ID', { selectionMode: 'SEQUENTIAL' }),
      block('LOOP', 'Loop'),
    ],
  },
  {
    key: 'kids-learning',
    name: 'Kids Learning',
    description: 'Cartoons + educational segments for young viewers',
    blocks: [
      block('INTRO', 'Kids Intro', { selectionMode: 'SEQUENTIAL' }),
      block('CARTOON', 'Cartoon', { selectionMode: 'RANDOM' }),
      block('MOVIE', 'Learning Segment', { selectionMode: 'SEQUENTIAL' }),
      block('PROMO', 'Promo', { selectionMode: 'RANDOM' }),
      block('STATION_ID', 'Station ID', { selectionMode: 'SEQUENTIAL' }),
      block('LOOP', 'Loop'),
    ],
  },
];

export function instantiateTemplate(templateKey: string): BlueprintBlock[] {
  const tpl = BLUEPRINT_TEMPLATES.find((t) => t.key === templateKey);
  if (!tpl) return [];
  return tpl.blocks.map((b) => ({ ...b, id: uuidv4(), config: { ...b.config } }));
}
