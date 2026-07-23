import { useEffect, useRef } from 'react';
import createGlobe, { type Globe } from 'cobe';

/** Erbil / Kurdistan region */
const MARKER: [number, number] = [36.1911, 44.0092];
const GLOBE_SCALE = 1.05;
const MARKER_ELEVATION = 0.06;

type HeroGlobeProps = {
  className?: string;
};

function latLonToVec(lat: number, lon: number): [number, number, number] {
  const phi = (lat * Math.PI) / 180;
  const theta = (lon * Math.PI) / 180 - Math.PI;
  const cosPhi = Math.cos(phi);
  return [-cosPhi * Math.cos(theta), Math.sin(phi), cosPhi * Math.sin(theta)];
}

/** Project a lat/lon onto the canvas, matching cobe's camera math. */
function projectMarker(
  lat: number,
  lon: number,
  phi: number,
  theta: number,
  scale: number,
  elevation: number,
): { x: number; y: number; visible: boolean } {
  const [x0, y0, z0] = latLonToVec(lat, lon);
  const r = 0.8 + elevation;
  const px = x0 * r;
  const py = y0 * r;
  const pz = z0 * r;

  const cosTheta = Math.cos(theta);
  const cosPhi = Math.cos(phi);
  const sinTheta = Math.sin(theta);
  const sinPhi = Math.sin(phi);

  const rx = cosPhi * px + sinPhi * pz;
  const ry = sinPhi * sinTheta * px + cosTheta * py - cosPhi * sinTheta * pz;
  const rz = -sinPhi * cosTheta * px + sinTheta * py + cosPhi * cosTheta * pz;

  const x = (rx * scale + 1) / 2;
  const y = (-ry * scale + 1) / 2;
  const visible = rz >= 0 || rx * rx + ry * ry >= 0.64;

  return { x, y, visible };
}

export default function HeroGlobe({ className }: HeroGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flagRef = useRef<HTMLDivElement>(null);
  const phiRef = useRef(2.65);
  const thetaRef = useRef(0.22);
  const dragRef = useRef(0);
  const pointerOriginRef = useRef<number | null>(null);
  const widthRef = useRef(0);
  const globeRef = useRef<Globe | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const measure = () => {
      widthRef.current = canvas.offsetWidth || 600;
    };
    measure();

    const size = widthRef.current * 2;
    const globe = createGlobe(canvas, {
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      width: size,
      height: size,
      phi: phiRef.current,
      theta: thetaRef.current,
      dark: 1,
      diffuse: 1.15,
      mapSamples: 28000,
      mapBrightness: 4.2,
      baseColor: [0.82, 0.82, 0.86],
      markerColor: [1, 1, 1],
      glowColor: [0.045, 0.045, 0.05],
      scale: GLOBE_SCALE,
      opacity: 0.92,
      offset: [0, 0],
      markerElevation: MARKER_ELEVATION,
      // Tiny white pin under the flag so the glow still reads
      markers: [{ location: MARKER, size: 0.028, id: 'kurdistan' }],
    });
    globeRef.current = globe;

    const tick = () => {
      if (pointerOriginRef.current === null) {
        phiRef.current += 0.0028;
      }

      const phi = phiRef.current + dragRef.current;
      const theta = thetaRef.current;
      const w = widthRef.current * 2;

      globe.update({
        width: w,
        height: w,
        phi,
        theta,
      });

      const flag = flagRef.current;
      if (flag) {
        const { x, y, visible } = projectMarker(
          MARKER[0],
          MARKER[1],
          phi,
          theta,
          GLOBE_SCALE,
          MARKER_ELEVATION,
        );
        flag.style.left = `${x * 100}%`;
        flag.style.top = `${y * 100}%`;
        flag.style.opacity = visible ? '1' : '0';
        flag.style.transform = visible
          ? 'translate(-50%, -50%) scale(1)'
          : 'translate(-50%, -50%) scale(0.7)';
        flag.style.filter = visible ? 'none' : 'blur(4px)';
        flag.setAttribute('aria-hidden', visible ? 'false' : 'true');
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    const onResize = () => measure();
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', onResize);
      globe.destroy();
      globeRef.current = null;
    };
  }, []);

  return (
    <div className={`relative ${className ?? ''}`}>
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
        style={{ contain: 'layout paint size', width: '100%', height: '100%' }}
        onPointerDown={(e) => {
          pointerOriginRef.current = e.clientX - dragRef.current * 200;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (pointerOriginRef.current === null) return;
          dragRef.current = (e.clientX - pointerOriginRef.current) / 200;
        }}
        onPointerUp={(e) => {
          if (pointerOriginRef.current === null) return;
          phiRef.current += dragRef.current;
          dragRef.current = 0;
          pointerOriginRef.current = null;
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* already released */
          }
        }}
        onPointerCancel={() => {
          if (pointerOriginRef.current === null) return;
          phiRef.current += dragRef.current;
          dragRef.current = 0;
          pointerOriginRef.current = null;
        }}
      />

      <div
        ref={flagRef}
        className="pointer-events-none absolute z-10 transition-[opacity,filter,transform] duration-200 ease-out"
        style={{ left: '50%', top: '50%', opacity: 0 }}
      >
        <div className="relative">
          <div className="absolute inset-0 -m-2 rounded-sm bg-white/25 blur-md" />
          <img
            src="/images/kurdistan-flag.png"
            alt="Kurdistan"
            className="relative h-7 w-auto rounded-[2px] object-cover shadow-[0_0_0_1px_rgba(255,255,255,0.35),0_4px_14px_rgba(0,0,0,0.55)] sm:h-8 lg:h-9"
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}
