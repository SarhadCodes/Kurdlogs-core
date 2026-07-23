import { forwardRef, useImperativeHandle, useRef, useEffect, useState, useCallback } from 'react';
import Hls from 'hls.js';
import * as dashjs from 'dashjs';
import { Copy, ExternalLink, WifiOff } from 'lucide-react';
import { useViewerHeartbeat } from '../hooks/useViewerHeartbeat';
import { setViewerStreamMeta } from '../utils/viewerSession';
import type { PlayerEngine } from '../types/player';
import { appendStreamAuthToUrl, getStreamAuthFromSrc } from '../utils/streamAuth';

export interface StreamQualityInfo {
  label: string;
  height?: number;
  bitrateKbps?: number;
}

export interface HlsQualityLevel {
  index: number;
  label: string;
  height?: number;
  bitrateKbps?: number;
}

export interface LivePlayerHandle {
  getVideoElement: () => HTMLVideoElement | null;
  setQualityLevel: (levelIndex: number) => void;
  getQualityLevel: () => number;
}

interface LivePlayerProps {
  src: string;
  autoPlay?: boolean;
  channelId?: string;
  engine?: PlayerEngine;
  controls?: boolean;
  onVideoMeta?: (meta: { width: number; height: number }) => void;
  onQualityChange?: (quality: StreamQualityInfo | null) => void;
  onLevelsChange?: (levels: HlsQualityLevel[]) => void;
  onCanManualQuality?: (can: boolean) => void;
  forcedQualityLevel?: number;
  showQualityOverlay?: boolean;
  /** Stable id for MCR lifecycle logging */
  playerId?: string;
  /** Hold playback hidden until video dimensions are available (control room preview). */
  waitForVideo?: boolean;
  /** Tighter HLS buffer for monitoring. */
  lowLatency?: boolean;
}

function formatQualityLabel(level?: { height?: number; name?: string }): string {
  if (level?.name && /\d+p/i.test(level.name)) {
    const m = level.name.match(/(\d+p)/i);
    if (m) return m[1].toLowerCase();
  }
  const h = level?.height;
  if (h && h > 0) {
    if (h >= 1080) return '1080p';
    if (h >= 720) return '720p';
    if (h >= 480) return '480p';
    return `${h}p`;
  }
  return 'Auto';
}

function qualityFromVideoElement(video: HTMLVideoElement): StreamQualityInfo {
  const h = video.videoHeight;
  const w = video.videoWidth;
  if (h <= 0) return { label: 'Unknown' };
  const shortEdge = Math.min(w, h);
  if (shortEdge >= 1080 || (w >= 1920 && h >= 1080)) return { label: '1080p' };
  if (shortEdge >= 720 || (w >= 1280 && h >= 720)) return { label: '720p' };
  if (shortEdge >= 480) return { label: '480p' };
  return { label: `${h}p` };
}

function mapHlsLevels(hls: Hls): HlsQualityLevel[] {
  return hls.levels
    .map((level, index) => ({
      index,
      label: formatQualityLabel({ height: level.height, name: level.name }),
      height: level.height,
      bitrateKbps: level.bitrate ? Math.round(level.bitrate / 1000) : undefined,
    }))
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
}

function resolveEngine(engine: PlayerEngine, src: string): PlayerEngine {
  if (engine !== 'auto') return engine;
  if (src.includes('.mpd')) return 'dashjs';
  return 'hlsjs';
}

const LivePlayer = forwardRef<LivePlayerHandle, LivePlayerProps>(function LivePlayer(
  {
    src,
    autoPlay = true,
    channelId,
    engine = 'auto',
    controls = true,
    onVideoMeta,
    onQualityChange,
    onLevelsChange,
    onCanManualQuality,
    forcedQualityLevel = -1,
    showQualityOverlay = false,
    playerId,
    waitForVideo = false,
    lowLatency = false,
  },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const dashRef = useRef<dashjs.MediaPlayerClass | null>(null);
  const forcedLevelRef = useRef(forcedQualityLevel);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentQuality, setCurrentQuality] = useState<StreamQualityInfo | null>(null);
  const [videoReady, setVideoReady] = useState(!waitForVideo);

  const resolvedEngine = resolveEngine(engine, src);
  const canManualHls = resolvedEngine === 'hlsjs' || (resolvedEngine === 'auto' && !src.includes('.mpd'));

  const emitQuality = useCallback(
    (quality: StreamQualityInfo | null) => {
      setCurrentQuality(quality);
      onQualityChange?.(quality);
      if (quality) {
        setViewerStreamMeta({
          quality: quality.label,
          bitrateKbps: quality.bitrateKbps,
          player: 'KurdLogs Core',
        });
      }
    },
    [onQualityChange]
  );

  const applyForcedLevel = useCallback((hls: Hls) => {
    const level = forcedLevelRef.current;
    hls.currentLevel = level;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      getVideoElement: () => videoRef.current,
      setQualityLevel: (levelIndex: number) => {
        forcedLevelRef.current = levelIndex;
        const hls = hlsRef.current;
        if (hls) {
          hls.currentLevel = levelIndex;
        }
      },
      getQualityLevel: () => hlsRef.current?.currentLevel ?? forcedLevelRef.current,
    }),
    []
  );

  useEffect(() => {
    forcedLevelRef.current = forcedQualityLevel;
    const hls = hlsRef.current;
    if (hls) {
      hls.currentLevel = forcedQualityLevel;
    }
  }, [forcedQualityLevel]);

  useEffect(() => {
    onCanManualQuality?.(canManualHls && Hls.isSupported());
  }, [canManualHls, onCanManualQuality, src]);

  const absoluteUrl =
    typeof window !== 'undefined' ? new URL(src, window.location.origin).href : src;

  useViewerHeartbeat(channelId, Boolean(channelId));

  useEffect(() => {
    if (!playerId) return;
    console.info(`[MCR_PLAYER] action=create playerId=${playerId}`);
    return () => {
      console.info(`[MCR_PLAYER] action=destroy playerId=${playerId}`);
    };
  }, [playerId]);

  useEffect(() => {
    setVideoReady(!waitForVideo);
  }, [src, waitForVideo]);

  useEffect(() => {
    if (!waitForVideo) return;
    const video = videoRef.current;
    if (!video) return;

    const markReady = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setVideoReady(true);
        if (autoPlay) video.play().catch(() => {});
      }
    };

    video.addEventListener('loadeddata', markReady);
    video.addEventListener('resize', markReady);
    markReady();
    return () => {
      video.removeEventListener('loadeddata', markReady);
      video.removeEventListener('resize', markReady);
    };
  }, [waitForVideo, src, autoPlay]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !onVideoMeta) return;

    const emitMeta = () => {
      const width = video.videoWidth || 0;
      const height = video.videoHeight || 0;
      if (width > 0 && height > 0) onVideoMeta({ width, height });
    };

    video.addEventListener('loadedmetadata', emitMeta);
    video.addEventListener('resize', emitMeta);
    return () => {
      video.removeEventListener('loadedmetadata', emitMeta);
      video.removeEventListener('resize', emitMeta);
    };
  }, [src, onVideoMeta]);

  useEffect(() => {
    if (resolvedEngine === 'external') return;

    const video = videoRef.current;
    if (!video || !src) {
      setError(true);
      setErrorMessage('No stream URL');
      return;
    }

    setError(false);
    setErrorMessage(null);
    emitQuality(null);
    onLevelsChange?.([]);

    if (playerId) {
      console.info(`[MCR_PLAYER] action=connect playerId=${playerId} src=${src.slice(0, 120)}`);
    }

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (dashRef.current) {
      dashRef.current.reset();
      dashRef.current = null;
    }

    if (resolvedEngine === 'dashjs') {
      if (!src.includes('.mpd')) {
        setError(true);
        setErrorMessage('DASH preview needs manifest.mpd — restart the channel if DASH was just enabled');
        return;
      }

      const auth = getStreamAuthFromSrc(src);
      const manifestUrl = appendStreamAuthToUrl(src, auth);
      const player = dashjs.MediaPlayer().create();

      if (auth.streamToken || auth.accessToken) {
        player.addRequestInterceptor((request) => {
          request.url = appendStreamAuthToUrl(request.url, auth);
          return Promise.resolve(request);
        });
      }

      player.updateSettings({
        streaming: {
          manifestUpdateRetryInterval: 3000,
          liveCatchup: {
            enabled: true,
          },
        },
      });

      player.on(dashjs.MediaPlayer.events.ERROR, (e: unknown) => {
        const err = e as { error?: { message?: string }; message?: string };
        const msg = err?.error?.message || err?.message || 'DASH playback failed';
        setError(true);
        setErrorMessage(msg);
      });

      player.initialize(video, manifestUrl, autoPlay);
      dashRef.current = player;

      return () => {
        player.reset();
        dashRef.current = null;
      };
    }

    if (resolvedEngine === 'native') {
      const auth = getStreamAuthFromSrc(src);
      video.src = appendStreamAuthToUrl(src, auth);
      if (autoPlay) {
        video.play().catch(() => {});
      }
      return () => {
        video.removeAttribute('src');
        video.load();
      };
    }

    if (resolvedEngine === 'hlsjs') {
      if (src.includes('.mpd')) {
        setError(true);
        setErrorMessage('HLS.js cannot play DASH — switch to DASH.js or Auto');
        return;
      }

      if (Hls.isSupported()) {
        const auth = getStreamAuthFromSrc(src);

        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: lowLatency,
          liveSyncDurationCount: lowLatency ? 2 : 4,
          liveMaxLatencyDurationCount: lowLatency ? 6 : 10,
          maxBufferLength: lowLatency ? 12 : 45,
          maxMaxBufferLength: lowLatency ? 20 : 60,
          backBufferLength: lowLatency ? 20 : 90,
          maxLiveSyncPlaybackRate: lowLatency ? 1.05 : 1.2,
          manifestLoadingMaxRetry: 8,
          levelLoadingMaxRetry: 8,
          fragLoadingMaxRetry: 10,
          xhrSetup: (xhr, url) => {
            const authedUrl = appendStreamAuthToUrl(url, auth);
            const reqUrl = new URL(authedUrl, window.location.origin);
            xhr.open('GET', reqUrl.pathname + reqUrl.search, true);
          },
        });

        hls.loadSource(src);
        hls.attachMedia(video);
        hls.currentLevel = forcedLevelRef.current;

        const reportHlsQuality = () => {
          if (hls.levels.length === 0) {
            const fromVideo = qualityFromVideoElement(video);
            if (fromVideo.label !== 'Unknown') {
              emitQuality(fromVideo);
            }
            return;
          }
          const level =
            hls.currentLevel >= 0
              ? hls.levels[hls.currentLevel]
              : hls.loadLevel >= 0
                ? hls.levels[hls.loadLevel]
                : hls.levels[0];
          if (!level) return;
          emitQuality({
            label: formatQualityLabel({ height: level.height, name: level.name }),
            height: level.height,
            bitrateKbps: level.bitrate ? Math.round(level.bitrate / 1000) : undefined,
          });
        };

        const syncLevels = () => {
          if (hls.levels.length > 0) {
            onLevelsChange?.(mapHlsLevels(hls));
          }
        };

        const onVideoQualityFallback = () => {
          if (hls.levels.length > 0) return;
          const fromVideo = qualityFromVideoElement(video);
          if (fromVideo.label !== 'Unknown') emitQuality(fromVideo);
        };
        video.addEventListener('loadedmetadata', onVideoQualityFallback);
        video.addEventListener('resize', onVideoQualityFallback);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          syncLevels();
          applyForcedLevel(hls);
          reportHlsQuality();
          if (autoPlay && !waitForVideo) {
            video.muted = true;
            video.play().catch(() => {});
          }
        });

        hls.on(Hls.Events.LEVEL_SWITCHED, reportHlsQuality);
        hls.on(Hls.Events.LEVEL_LOADED, () => {
          syncLevels();
          reportHlsQuality();
        });
        hls.on(Hls.Events.LEVEL_UPDATED, () => {
          syncLevels();
          reportHlsQuality();
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                setError(true);
                setErrorMessage('HLS playback failed');
                hls.destroy();
                break;
            }
          }
        });

        hlsRef.current = hls;

        return () => {
          video.removeEventListener('loadedmetadata', onVideoQualityFallback);
          video.removeEventListener('resize', onVideoQualityFallback);
          hls.destroy();
          hlsRef.current = null;
          onLevelsChange?.([]);
        };
      }

      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        const auth = getStreamAuthFromSrc(src);
        const onMeta = () => {
          const q = qualityFromVideoElement(video);
          emitQuality(q);
        };
        video.addEventListener('loadedmetadata', onMeta);
        video.src = appendStreamAuthToUrl(src, auth);
        if (autoPlay && !waitForVideo) {
          video.play().catch(() => {});
        }
        return () => {
          video.removeEventListener('loadedmetadata', onMeta);
          video.removeAttribute('src');
          video.load();
        };
      }

      setError(true);
      setErrorMessage('HLS is not supported in this browser');
      return;
    }

    setError(true);
    setErrorMessage('Unknown player mode');
  }, [src, autoPlay, resolvedEngine, emitQuality, onLevelsChange, applyForcedLevel, waitForVideo, lowLatency]);

  if (resolvedEngine === 'external') {
    const vlcUrl = `vlc://${absoluteUrl.replace(/^https?:\/\//, '')}`;

    return (
      <div className="w-full h-full min-h-[200px] flex flex-col items-center justify-center gap-4 p-6 bg-black text-center">
        <p className="text-sm text-gray-400">Use VLC, MPV, or another player with this URL</p>
        <code className="w-full max-w-full px-3 py-2 bg-[#111] border border-[#333] rounded text-xs text-gray-300 font-mono break-all">
          {absoluteUrl}
        </code>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(absoluteUrl)}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-[#222] hover:bg-[#2a2a2a] border border-[#333] rounded-md text-white"
          >
            <Copy className="w-4 h-4" />
            Copy URL
          </button>
          <a
            href={vlcUrl}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-[#222] hover:bg-[#2a2a2a] border border-[#333] rounded-md text-white"
          >
            <ExternalLink className="w-4 h-4" />
            Open in VLC
          </a>
          <a
            href={absoluteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-sm bg-white text-black hover:bg-gray-200 rounded-md font-medium"
          >
            <ExternalLink className="w-4 h-4" />
            Open in tab
          </a>
        </div>
      </div>
    );
  }

  if (error || !src) {
    return (
      <div className="w-full h-full min-h-[200px] flex flex-col items-center justify-center bg-black">
        <WifiOff size={32} className="text-[#555] mb-2" />
        <span className="text-[#888] text-sm text-center px-4 max-w-md break-words">
          {errorMessage || 'Stream unavailable'}
        </span>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-[200px] bg-black">
      <video
        ref={videoRef}
        className={`w-full h-full object-contain bg-black transition-opacity duration-300 ${
          waitForVideo && !videoReady ? 'opacity-0' : 'opacity-100'
        }`}
        controls={controls}
        playsInline
      />
      {waitForVideo && !videoReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/90 text-gray-400">
          <div className="h-8 w-8 rounded-full border-2 border-emerald-500/30 border-t-emerald-400 animate-spin" />
          <span className="text-xs tracking-wide">Waiting for video…</span>
        </div>
      )}
      {showQualityOverlay && currentQuality && canManualHls && (
        <div className="absolute top-2 right-2 z-10 pointer-events-none rounded bg-black/80 border border-emerald-500/40 px-2.5 py-1 text-xs font-mono text-emerald-300">
          {currentQuality.label}
          {currentQuality.bitrateKbps ? ` · ${currentQuality.bitrateKbps} kbps` : ''}
        </div>
      )}
    </div>
  );
});

export default LivePlayer;
