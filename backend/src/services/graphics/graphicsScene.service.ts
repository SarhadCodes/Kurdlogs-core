import { AppError } from '../../middleware/errorHandler';

export type GraphicsNode = {
  id: string;
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
  zIndex: number;
};

export type GraphicsDocument = {
  canvas: { width: number; height: number; frameRate: number };
  nodes: GraphicsNode[];
};

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

/** Strict Phase 1 schema: a static image surface only. */
export function validateGraphicsDocument(raw: unknown): GraphicsDocument {
  if (!raw || typeof raw !== 'object') throw new AppError('A graphics scene document is required', 400);
  const input = raw as Record<string, unknown>;
  const canvas = input.canvas as Record<string, unknown> | undefined;
  if (!canvas || !finite(canvas.width) || !finite(canvas.height) || !finite(canvas.frameRate)) {
    throw new AppError('Scene canvas must include numeric width, height, and frameRate', 400);
  }
  const canvasWidth = Number(canvas.width);
  const canvasHeight = Number(canvas.height);
  const canvasFrameRate = Number(canvas.frameRate);
  if (canvasWidth < 320 || canvasWidth > 3840 || canvasHeight < 180 || canvasHeight > 2160) {
    throw new AppError('Scene canvas dimensions are outside supported limits', 400);
  }
  if (canvasFrameRate < 1 || canvasFrameRate > 60) throw new AppError('Scene frame rate must be between 1 and 60', 400);
  if (!Array.isArray(input.nodes) || input.nodes.length > 20) throw new AppError('Scene must contain at most 20 nodes', 400);

  const ids = new Set<string>();
  const nodes = input.nodes.map((rawNode) => {
    const node = rawNode as Record<string, unknown>;
    if (node.type !== 'image' || typeof node.id !== 'string' || !node.id.trim() || ids.has(node.id)) {
      throw new AppError('Each scene node must be a uniquely identified image node', 400);
    }
    ids.add(node.id);
    for (const key of ['x', 'y', 'width', 'height', 'opacity', 'zIndex']) {
      if (!finite(node[key])) throw new AppError(`Scene node ${node.id} has invalid ${key}`, 400);
    }
    const width = Number(node.width);
    const height = Number(node.height);
    const opacity = Number(node.opacity);
    if (width <= 0 || height <= 0 || width > canvasWidth || height > canvasHeight) {
      throw new AppError(`Scene node ${node.id} has invalid dimensions`, 400);
    }
    if (opacity < 0 || opacity > 1 || typeof node.visible !== 'boolean') {
      throw new AppError(`Scene node ${node.id} has invalid visibility or opacity`, 400);
    }
    return node as unknown as GraphicsNode;
  });
  return { canvas: { width: canvasWidth, height: canvasHeight, frameRate: canvasFrameRate }, nodes };
}
