export type PlayerEngine = 'auto' | 'hlsjs' | 'dashjs' | 'native' | 'external';

export const PLAYER_ENGINE_KEY = 'kurdlogs_player_engine';

export const PLAYER_ENGINE_OPTIONS: {
  id: PlayerEngine;
  label: string;
  description: string;
}[] = [
  { id: 'auto', label: 'Auto', description: 'HLS preview (master.m3u8, adaptive)' },
  { id: 'hlsjs', label: 'HLS.js', description: 'JavaScript HLS player (master.m3u8)' },
  { id: 'dashjs', label: 'DASH.js', description: 'MPEG-DASH player (manifest.mpd)' },
  { id: 'native', label: 'Native', description: 'Browser built-in video element' },
  { id: 'external', label: 'External', description: 'Copy URL or open in VLC / another app' },
];
