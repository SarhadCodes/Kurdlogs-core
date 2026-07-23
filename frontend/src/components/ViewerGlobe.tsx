import { useEffect, useRef } from 'react';
import { hexToCobeColor, pickClosestMarker } from '../utils/globeProjection';
import { qualityMarkerColor, type CobeMarker } from '../types/viewer';

interface ViewerGlobeProps {
  markers: CobeMarker[];
  selectedId?: string | null;
  onSelectViewer?: (id: string | null) => void;
  className?: string;
}

function markerSize(quality?: string, selected?: boolean): number {
  let size = 0.04;
  const q = (quality || '').toLowerCase();
  if (q.includes('1080')) size = 0.065;
  else if (q.includes('720')) size = 0.052;
  else if (q.includes('480')) size = 0.042;
  if (selected) size *= 1.35;
  return size;
}

/** cobe globe — native markers stay pinned to lat/lng while rotating. */
export default function ViewerGlobe({
  markers,
  selectedId,
  onSelectViewer,
  className = '',
}: ViewerGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markersRef = useRef(markers);
  const selectedIdRef = useRef(selectedId);
  const phiRef = useRef(0);
  const thetaRef = useRef(0.22);
  const draggingRef = useRef(false);
  const autoRotateRef = useRef(true);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const pointerDownRef = useRef({ x: 0, y: 0 });
  const canvasSizeRef = useRef(400);

  useEffect(() => {
    markersRef.current = markers;
  }, [markers]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let globe: { destroy: () => void } | null = null;
    let destroyed = false;

    const onPointerDown = (e: PointerEvent) => {
      draggingRef.current = true;
      autoRotateRef.current = false;
      pointerDownRef.current = { x: e.clientX, y: e.clientY };
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - lastPointerRef.current.x;
      const dy = e.clientY - lastPointerRef.current.y;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      phiRef.current += dx * 0.005;
      thetaRef.current = Math.max(0.1, Math.min(1.2, thetaRef.current + dy * 0.005));
    };

    const onPointerUp = (e: PointerEvent) => {
      const moved =
        Math.abs(e.clientX - pointerDownRef.current.x) +
        Math.abs(e.clientY - pointerDownRef.current.y);

      if (moved < 8 && onSelectViewer) {
        const rect = canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        const picked = pickClosestMarker(
          clickX,
          clickY,
          markersRef.current.map((m) => ({ id: m.id, location: m.location })),
          phiRef.current,
          thetaRef.current,
          canvasSizeRef.current,
          36
        );
        onSelectViewer(picked);
      }

      draggingRef.current = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      canvas.style.cursor = 'grab';
    };

    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    const init = async () => {
      const createGlobe = (await import('cobe')).default;
      if (destroyed) return;

      const size = Math.min(container.clientWidth, window.innerHeight * 0.65, 720);
      canvasSizeRef.current = size;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const px = Math.floor(size * dpr);

      canvas.width = px;
      canvas.height = px;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;

      globe = createGlobe(canvas, {
        devicePixelRatio: dpr,
        width: px,
        height: px,
        phi: phiRef.current,
        theta: thetaRef.current,
        dark: 1,
        diffuse: 1.1,
        mapSamples: 20000,
        mapBrightness: 4.8,
        baseColor: [0.12, 0.12, 0.12],
        markerColor: [0.35, 0.65, 0.95],
        glowColor: [0.02, 0.02, 0.02],
        markers: [],
        onRender: () => {
          if (autoRotateRef.current && !draggingRef.current) {
            phiRef.current += 0.004;
          }

          const list = markersRef.current;
          const sel = selectedIdRef.current;

          const colorSource =
            list.find((m) => m.id === sel)?.quality ??
            (list.length === 1 ? list[0]?.quality : undefined);

          return {
            phi: phiRef.current,
            theta: thetaRef.current,
            markers: list.map((m) => ({
              location: m.location,
              size: markerSize(m.quality, m.id === sel),
            })),
            markerColor: hexToCobeColor(qualityMarkerColor(colorSource)),
          };
        },
      });
    };

    init();

    const ro = new ResizeObserver(() => {
      globe?.destroy();
      globe = null;
      init();
    });
    ro.observe(container);

    return () => {
      destroyed = true;
      ro.disconnect();
      globe?.destroy();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    };
  }, [onSelectViewer]);

  return (
    <div ref={containerRef} className={`flex items-center justify-center w-full ${className}`}>
      <canvas ref={canvasRef} className="block select-none touch-none" aria-hidden />
    </div>
  );
}
