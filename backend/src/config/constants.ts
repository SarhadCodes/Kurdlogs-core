export const SUPPORTED_PROTOCOLS = [
  'M3U8', 'MP4', 'RTMP', 'MPEGTS', 'SRT', 'UDP', 'HTTP'
] as const;

export const MAX_RECONNECT_ATTEMPTS = 10;
export const DEFAULT_RECONNECT_DELAY = 5000;

export const DEFAULT_OVERLAY_POSITIONS = {
  'top-left': 'x=20:y=20',
  'top-right': 'x=w-overlay_w-20:y=20',
  'bottom-left': 'x=20:y=h-overlay_h-20',
  'bottom-right': 'x=w-overlay_w-20:y=h-overlay_h-20',
  'center': 'x=(w-overlay_w)/2:y=(h-overlay_h)/2'
};

export const TRANSCODING_PRESETS = [
  {
    name: '1080p High Quality',
    resolution: 'RES_1080P',
    videoBitrate: '5000k',
    audioBitrate: '192k',
    fps: 60,
  },
  {
    name: '720p Standard',
    resolution: 'RES_720P',
    videoBitrate: '2500k',
    audioBitrate: '128k',
    fps: 30,
  },
  {
    name: '480p Low Bandwidth',
    resolution: 'RES_480P',
    videoBitrate: '1000k',
    audioBitrate: '96k',
    fps: 30,
  }
];
