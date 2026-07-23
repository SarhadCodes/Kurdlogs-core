import { useEffect, useMemo, useRef } from 'react';
import { Calendar, Clock, Loader2, Play, Radio, AlertTriangle } from 'lucide-react';
import type { BlueprintLiveCursor, BlueprintSimulation, SimulationHorizon } from '../../types';
import { blockMeta } from './blockMeta';
import {
  computeTimelineDisplayOffsetMs,
  formatTimelineClock,
  formatTimelineDay,
  logTimeDebug,
} from '../../utils/scheduleTimeFormat';

interface Props {
  simulation: BlueprintSimulation | null;
  horizon: SimulationHorizon;
  onHorizonChange: (h: SimulationHorizon) => void;
  onLoad: () => void;
  loading: boolean;
  linkedChannelName?: string;
  liveSegmentIndex?: number | null;
  liveCursor?: BlueprintLiveCursor | null;
  isPolling?: boolean;
}

const HORIZONS: { value: SimulationHorizon; label: string }[] = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
];

function formatDuration(sec: number) {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function BlueprintPreviewTimeline({
  simulation,
  horizon,
  onHorizonChange,
  onLoad,
  loading,
  linkedChannelName,
  liveSegmentIndex = null,
  liveCursor = null,
  isPolling = false,
}: Props) {
  let lastDay = '';
  const liveIdx = liveSegmentIndex ?? simulation?.liveSegmentIndex ?? null;
  const liveRowRef = useRef<HTMLDivElement | null>(null);
  const prevLiveIdx = useRef<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const displayOffsetMs = useMemo(() => {
    if (!simulation?.segments?.length || liveIdx == null || liveIdx < 0) return 0;
    const liveSeg = simulation.segments[liveIdx];
    return computeTimelineDisplayOffsetMs(liveSeg?.startsAt, liveCursor?.now);
  }, [simulation?.segments, liveIdx, liveCursor?.now]);

  useEffect(() => {
    if (liveIdx == null || liveIdx < 0 || !simulation?.segments?.length) return;
    const liveSeg = simulation.segments[liveIdx];
    if (!liveSeg?.startsAt) return;
    const displayed = formatTimelineClock(liveSeg.startsAt, displayOffsetMs);
    logTimeDebug('timeline-now-row', liveSeg.startsAt, displayOffsetMs, displayed);
    if (simulation.scheduleAnchor) {
      logTimeDebug(
        'timeline-anchor',
        simulation.scheduleAnchor,
        displayOffsetMs,
        formatTimelineClock(simulation.scheduleAnchor, displayOffsetMs)
      );
    }
  }, [liveIdx, simulation?.segments, simulation?.scheduleAnchor, displayOffsetMs]);

  useEffect(() => {
    if (liveIdx == null || liveIdx === prevLiveIdx.current) return;
    prevLiveIdx.current = liveIdx;
    const el = liveRowRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [liveIdx]);

  return (
    <div className="flex flex-col h-full min-h-[400px] border border-[#333] rounded-xl bg-[#0a0a0a] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#333] bg-[#111] flex flex-wrap items-center gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Play className="w-4 h-4" /> Watch Blueprint
            {isPolling && (
              <span className="inline-flex items-center gap-1 text-[10px] font-normal text-emerald-400/90 uppercase tracking-wide">
                <Radio className="w-3 h-3 animate-pulse" /> Live
              </span>
            )}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {linkedChannelName
              ? `Live schedule monitor — ${linkedChannelName}`
              : 'Scroll through what your channel will play'}
          </p>
        </div>
        <div className="flex gap-1 ml-auto">
          {HORIZONS.map((h) => (
            <button
              key={h.value}
              type="button"
              onClick={() => onHorizonChange(h.value)}
              className={`px-3 py-1.5 text-xs rounded-md transition ${
                horizon === h.value ? 'bg-white text-black' : 'text-gray-500 hover:text-white hover:bg-[#222]'
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={onLoad}
          className="px-4 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded-md disabled:opacity-50"
        >
          {loading ? 'Generating…' : 'Refresh timeline'}
        </button>
      </div>

      {liveCursor?.mismatch && (
        <div className="px-4 py-2 bg-amber-950/40 border-b border-amber-900/50 flex items-center gap-2 text-xs text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Sync issue: {liveCursor.mismatch}</span>
        </div>
      )}

      {!simulation ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-600 p-8 text-center">
          {loading ? (
            <Loader2 className="w-8 h-8 animate-spin mb-3 text-violet-500" />
          ) : (
            <Calendar className="w-10 h-10 mb-3 opacity-40" />
          )}
          <p className="text-sm max-w-sm">
            Preview the future of your channel — intros, movies, promos, and station IDs in order.
            {linkedChannelName && (
              <span className="block mt-2 text-violet-400/80">
                Linked to {linkedChannelName} — timeline loads automatically when available.
              </span>
            )}
          </p>
        </div>
      ) : (
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4">
          <div className="max-w-xl mx-auto relative">
            <div className="absolute left-[5.5rem] top-0 bottom-0 w-px bg-gradient-to-b from-violet-500/50 via-[#333] to-transparent" />
            {simulation.segments.map((seg, i) => {
              const day = formatTimelineDay(seg.startsAt, displayOffsetMs);
              const showDay = day !== lastDay;
              lastDay = day;
              const meta = blockMeta(seg.blockType);
              const isLive = liveIdx !== null && i === liveIdx;
              const displayedTime = formatTimelineClock(seg.startsAt, displayOffsetMs);

              return (
                <div key={`${seg.itemId}-${seg.startsAt}-${i}`} ref={isLive ? liveRowRef : undefined}>
                  {showDay && (
                    <div className="flex items-center gap-3 mb-4 mt-2 first:mt-0">
                      <div className="w-[5.5rem] shrink-0" />
                      <span className="text-xs font-medium text-violet-400 uppercase tracking-wide">{day}</span>
                    </div>
                  )}
                  <div className={`flex gap-3 mb-3 group ${isLive ? 'relative' : ''}`}>
                    {isLive && (
                      <div className="absolute -inset-1 rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/40 pointer-events-none" />
                    )}
                    <div className="w-[5.5rem] shrink-0 text-right pt-2.5 relative z-[1]">
                      <p className={`text-sm font-mono tabular-nums ${isLive ? 'text-emerald-400' : 'text-white'}`}>
                        {displayedTime}
                      </p>
                      <p className="text-[10px] text-gray-600">{formatDuration(seg.durationSec)}</p>
                    </div>
                    <div className="relative shrink-0 pt-3 z-[1]">
                      <div
                        className={`w-2.5 h-2.5 rounded-full border-2 border-[#0a0a0a] transition-transform group-hover:scale-125 ${
                          isLive
                            ? 'bg-emerald-400 ring-2 ring-emerald-400/80 animate-pulse'
                            : 'bg-violet-500 ring-2 ring-violet-500/60'
                        }`}
                      />
                    </div>
                    <div
                      className={`flex-1 rounded-lg border px-3 py-2.5 transition-all group-hover:brightness-110 relative z-[1] ${meta.color} ${
                        isLive ? 'border-emerald-500/50' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-white flex items-center gap-2">
                          {seg.blockLabel}
                          {isLive && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
                              <Radio className="w-3 h-3" /> Now
                            </span>
                          )}
                        </p>
                        <span className="text-[10px] text-gray-500 uppercase">{seg.blockType.replace(/_/g, ' ')}</span>
                      </div>
                      <p className="text-xs text-gray-400 truncate mt-0.5">{seg.title}</p>
                    </div>
                  </div>
                </div>
              );
            })}
            {simulation.segments.length === 0 && (
              <p className="text-center text-gray-600 text-sm py-12">No segments generated — check block playlists.</p>
            )}
          </div>
        </div>
      )}

      {simulation && (
        <div className="px-4 py-2 border-t border-[#333] bg-[#111] flex flex-wrap items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {simulation.coverage?.formatted ?? `${Math.round(simulation.stats.totalDurationSec / 3600)}h`} total
          </span>
          <span>{simulation.stats.totalSegments} segments</span>
          {simulation.scheduleAnchor && (
            <span className="text-gray-600">
              Anchor {formatTimelineClock(simulation.scheduleAnchor, displayOffsetMs)}
            </span>
          )}
          {(liveCursor?.current ?? liveCursor?.visible) && (
            <span className="text-emerald-500/90 truncate max-w-[12rem]" title={(liveCursor.current ?? liveCursor.visible)!.title}>
              On air: {(liveCursor.current ?? liveCursor.visible)!.title}
            </span>
          )}
          {liveCursor?.timing && (
            <span className="text-gray-600">
              Playback source: {liveCursor.timing.playbackSource}
            </span>
          )}
          {simulation.syncedWithChannel && !liveCursor?.current && !liveCursor?.visible && (
            <span className="text-emerald-500/90">Engine sync active</span>
          )}
          {simulation.diversity && (
            <span className="ml-auto text-violet-400">Diversity {simulation.diversity.score}/100</span>
          )}
        </div>
      )}
    </div>
  );
}
