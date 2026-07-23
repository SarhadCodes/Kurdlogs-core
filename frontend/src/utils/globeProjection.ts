/** Match cobe's lat/lng → unit sphere conversion (see cobe marker shader). */
export function latLngToCobeVec3(lat: number, lng: number) {
  const latR = (lat * Math.PI) / 180;
  const lngR = (lng * Math.PI) / 180 - Math.PI;
  const cosLat = Math.cos(latR);
  return {
    x: -cosLat * Math.cos(lngR),
    y: Math.sin(latR),
    z: cosLat * Math.sin(lngR),
  };
}

/** cobe rotation matrix L(theta, phi) applied to marker positions. */
export function rotateCobeVec3(
  x: number,
  y: number,
  z: number,
  phi: number,
  theta: number
) {
  const c = Math.cos(theta);
  const d = Math.cos(phi);
  const e = Math.sin(theta);
  const f = Math.sin(phi);
  return {
    x: d * x - f * c * z,
    y: f * e * x + c * y + e * z,
    z: f * x - d * e * y + d * c * z,
  };
}

/** Project lat/lng to 2D canvas coords aligned with cobe globe rendering. */
export function projectLatLngToScreen(
  lat: number,
  lng: number,
  phi: number,
  theta: number,
  size: number
): { x: number; y: number; visible: boolean } {
  const v0 = latLngToCobeVec3(lat, lng);
  const v = rotateCobeVec3(v0.x, v0.y, v0.z, phi, theta);
  const visible = v.z > 0.02;
  const r = size * 0.4;
  return {
    x: size / 2 + v.x * r,
    y: size / 2 - v.y * r,
    visible,
  };
}

export function pickClosestMarker(
  clickX: number,
  clickY: number,
  markers: { id: string; location: [number, number] }[],
  phi: number,
  theta: number,
  canvasSize: number,
  hitRadius = 28
): string | null {
  let bestId: string | null = null;
  let bestDist = hitRadius * hitRadius;

  for (const m of markers) {
    const [lat, lng] = m.location;
    const p = projectLatLngToScreen(lat, lng, phi, theta, canvasSize);
    if (!p.visible) continue;
    const dx = clickX - p.x;
    const dy = clickY - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist) {
      bestDist = d2;
      bestId = m.id;
    }
  }

  return bestId;
}

/** Convert #rrggbb to cobe markerColor tuple [0-1]. */
export function hexToCobeColor(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [r, g, b];
}
