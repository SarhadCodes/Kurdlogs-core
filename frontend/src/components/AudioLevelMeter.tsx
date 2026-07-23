import { useEffect, useRef, useState } from 'react';

interface AudioLevelMeterProps {
  video: HTMLVideoElement | null;
  className?: string;
}

type AudioGraph = {
  ctx: AudioContext;
  analyser: AnalyserNode;
  consumers: number;
};

/** One graph per video element — createMediaElementSource can only run once per element. */
const graphs = new WeakMap<HTMLVideoElement, AudioGraph>();

function acquireGraph(video: HTMLVideoElement): AudioGraph {
  let graph = graphs.get(video);
  if (!graph) {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.65;
    const source = ctx.createMediaElementSource(video);
    // Tap analyser for meters; also route to speakers (otherwise the element goes silent).
    source.connect(analyser);
    source.connect(ctx.destination);
    graph = { ctx, analyser, consumers: 0 };
    graphs.set(video, graph);
  }
  graph.consumers += 1;
  if (graph.ctx.state === 'suspended') {
    graph.ctx.resume().catch(() => {});
  }
  return graph;
}

function releaseGraph(video: HTMLVideoElement) {
  const graph = graphs.get(video);
  if (!graph) return;
  graph.consumers -= 1;
  if (graph.consumers <= 0) {
    graph.ctx.close().catch(() => {});
    graphs.delete(video);
  }
}

export default function AudioLevelMeter({ video, className = '' }: AudioLevelMeterProps) {
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [active, setActive] = useState(false);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!video) {
      setLevel(0);
      setPeak(0);
      setActive(false);
      return;
    }

    let disposed = false;
    let graph: AudioGraph | null = null;
    let data: Uint8Array<ArrayBuffer> | null = null;

    const start = () => {
      try {
        graph = acquireGraph(video);
        data = new Uint8Array(graph.analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
        setActive(true);
        tick();
      } catch {
        setActive(false);
      }
    };

    const tick = () => {
      if (disposed || !graph || !data) return;
      graph.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const pct = Math.min(100, Math.round(rms * 280));
      setLevel(pct);
      setPeak((p) => Math.max(p * 0.96, pct));
      rafRef.current = requestAnimationFrame(tick);
    };

    if (video.readyState >= 2) {
      start();
    } else {
      video.addEventListener('loadeddata', start, { once: true });
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(rafRef.current);
      video.removeEventListener('loadeddata', start);
      if (graph) {
        releaseGraph(video);
      }
      setActive(false);
      setLevel(0);
      setPeak(0);
    };
  }, [video]);

  const bars = 16;
  const filled = Math.round((level / 100) * bars);

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">Audio</span>
        <span className="text-[10px] font-mono text-gray-400">
          {!active ? 'No signal' : level < 2 ? 'Silent' : `${level}%`}
        </span>
      </div>
      <div className="flex items-end gap-0.5 h-8">
        {Array.from({ length: bars }).map((_, i) => {
          const on = i < filled;
          const hot = i >= bars - 3;
          return (
            <div
              key={i}
              className={`flex-1 rounded-sm transition-colors duration-75 ${
                on
                  ? hot
                    ? 'bg-amber-400'
                    : 'bg-emerald-500'
                  : 'bg-[#2a2a2a]'
              }`}
              style={{ height: `${20 + (i / bars) * 80}%` }}
            />
          );
        })}
      </div>
      <div className="mt-1 h-0.5 bg-[#2a2a2a] rounded overflow-hidden">
        <div
          className="h-full bg-emerald-500/80 transition-all duration-75"
          style={{ width: `${level}%` }}
        />
      </div>
      <p className="text-[10px] text-gray-600 mt-1">
        Peak hold: {Math.round(peak)}% · Unmute the player controls to hear audio while monitoring
      </p>
    </div>
  );
}
