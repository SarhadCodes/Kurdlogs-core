declare module 'cobe' {
  export interface CobeState {
    phi: number;
    theta?: number;
    markers: { location: [number, number]; size: number }[];
  }

  export interface CobeOptions {
    devicePixelRatio?: number;
    width: number;
    height: number;
    phi?: number;
    theta?: number;
    dark?: number;
    diffuse?: number;
    mapSamples?: number;
    mapBrightness?: number;
    baseColor?: [number, number, number];
    markerColor?: [number, number, number];
    glowColor?: [number, number, number];
    markers?: { location: [number, number]; size: number }[];
    onRender?: (state: CobeState) => void;
  }

  export default function createGlobe(
    canvas: HTMLCanvasElement,
    options: CobeOptions
  ): { destroy: () => void };
}
