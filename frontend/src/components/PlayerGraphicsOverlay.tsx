import type { ChannelGraphics } from '../types';

const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function publicAssetUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const at = normalized.lastIndexOf('/uploads/');
  return at >= 0 ? normalized.slice(at) : normalized;
}

/** Browser-only scene preview for controlled KurdLogs players. */
export default function PlayerGraphicsOverlay({ graphics }: { graphics: ChannelGraphics | null }) {
  const scene = graphics?.scene;
  const asset = scene?.asset;
  const document = scene?.document;
  if (!graphics?.enabled || (graphics.mode !== 'PLAYER' && graphics.mode !== 'HYBRID') || !asset || !document) return null;
  const canvas = document.canvas;
  return <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden="true">
    {(document.nodes || []).map((raw, index) => {
      const node = raw as Record<string, unknown>;
      if (node.type !== 'image' || node.visible !== true) return null;
      const x = number(node.x, 0), y = number(node.y, 0), width = number(node.width, 0), height = number(node.height, 0);
      if (width <= 0 || height <= 0) return null;
      return <img key={String(node.id || index)} src={publicAssetUrl(asset.path)} alt="" className="absolute object-contain" style={{ left: `${(x / canvas.width) * 100}%`, top: `${(y / canvas.height) * 100}%`, width: `${(width / canvas.width) * 100}%`, height: `${(height / canvas.height) * 100}%`, opacity: Math.min(1, Math.max(0, number(node.opacity, 1))), zIndex: number(node.zIndex, index) }} />;
    })}
  </div>;
}
