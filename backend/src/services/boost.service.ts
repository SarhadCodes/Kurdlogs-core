import crypto from 'crypto';
import { BoostNodeStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const STALE_AFTER_MS = 90_000;
const CHECK_INTERVAL_MS = 30_000;

function createSecretKey(): string {
  return crypto.randomBytes(24).toString('hex');
}

export interface CreateBoostNodeInput {
  name: string;
  host: string;
  port?: number;
  encode?: boolean;
  stream?: boolean;
  maxChannels?: number;
  notes?: string;
}

export interface UpdateBoostNodeInput {
  name?: string;
  host?: string;
  port?: number;
  encode?: boolean;
  stream?: boolean;
  maxChannels?: number;
  status?: BoostNodeStatus;
  notes?: string | null;
}

export interface WorkerHeartbeatInput {
  hostname?: string;
  version?: string;
  cpu?: number;
  ram?: number;
  activeChannels?: number;
}

class BoostService {
  private staleTimer: NodeJS.Timeout | null = null;

  start() {
    if (this.staleTimer) return;
    this.staleTimer = setInterval(() => {
      this.markStaleNodesOffline().catch((err) =>
        logger.error('Boost stale-node check failed:', err)
      );
    }, CHECK_INTERVAL_MS);
    logger.info('Boost worker monitor started');
  }

  stop() {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
  }

  extractWorkerKey(req: { headers: Record<string, unknown>; body?: Record<string, unknown> }) {
    const headerKey = req.headers['x-boost-key'];
    if (typeof headerKey === 'string' && headerKey.trim()) {
      return headerKey.trim();
    }

    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.toLowerCase().startsWith('boost ')) {
      return auth.slice(6).trim();
    }

    const bodyKey = req.body?.secretKey;
    if (typeof bodyKey === 'string' && bodyKey.trim()) {
      return bodyKey.trim();
    }

    return null;
  }

  async listNodes() {
    return prisma.boostNode.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSummary() {
    const nodes = await prisma.boostNode.findMany();
    const byStatus = nodes.reduce(
      (acc, node) => {
        acc[node.status] = (acc[node.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      total: nodes.length,
      online: byStatus.ONLINE || 0,
      pending: byStatus.PENDING || 0,
      offline: byStatus.OFFLINE || 0,
      error: byStatus.ERROR || 0,
      encodeCapacity: nodes
        .filter((n) => n.encode && n.status === 'ONLINE')
        .reduce((sum, n) => sum + n.maxChannels, 0),
      streamCapacity: nodes
        .filter((n) => n.stream && n.status === 'ONLINE')
        .reduce((sum, n) => sum + n.maxChannels, 0),
    };
  }

  async createNode(input: CreateBoostNodeInput) {
    const name = input.name?.trim();
    const host = input.host?.trim();

    if (!name) throw new AppError('Node name is required', 400);
    if (!host) throw new AppError('Host address is required', 400);

    const port = input.port ?? 8443;
    if (port < 1 || port > 65535) throw new AppError('Port must be between 1 and 65535', 400);

    const encode = input.encode !== false;
    const stream = input.stream !== false;
    if (!encode && !stream) {
      throw new AppError('Node must support encoding, streaming, or both', 400);
    }

    const maxChannels = Math.min(Math.max(input.maxChannels ?? 4, 1), 64);

    return prisma.boostNode.create({
      data: {
        name,
        host,
        port,
        encode,
        stream,
        maxChannels,
        notes: input.notes?.trim() || null,
        secretKey: createSecretKey(),
        status: BoostNodeStatus.PENDING,
      },
    });
  }

  async updateNode(id: string, input: UpdateBoostNodeInput) {
    const existing = await prisma.boostNode.findUnique({ where: { id } });
    if (!existing) throw new AppError('Boost node not found', 404);

    const encode = input.encode ?? existing.encode;
    const stream = input.stream ?? existing.stream;
    if (!encode && !stream) {
      throw new AppError('Node must support encoding, streaming, or both', 400);
    }

    if (input.port != null && (input.port < 1 || input.port > 65535)) {
      throw new AppError('Port must be between 1 and 65535', 400);
    }

    return prisma.boostNode.update({
      where: { id },
      data: {
        name: input.name?.trim() || undefined,
        host: input.host?.trim() || undefined,
        port: input.port,
        encode: input.encode,
        stream: input.stream,
        maxChannels:
          input.maxChannels != null
            ? Math.min(Math.max(input.maxChannels, 1), 64)
            : undefined,
        status: input.status,
        notes: input.notes === null ? null : input.notes?.trim() || undefined,
      },
    });
  }

  async deleteNode(id: string) {
    const existing = await prisma.boostNode.findUnique({ where: { id } });
    if (!existing) throw new AppError('Boost node not found', 404);
    await prisma.boostNode.delete({ where: { id } });
  }

  async regenerateSecret(id: string) {
    const existing = await prisma.boostNode.findUnique({ where: { id } });
    if (!existing) throw new AppError('Boost node not found', 404);

    return prisma.boostNode.update({
      where: { id },
      data: {
        secretKey: createSecretKey(),
        status: BoostNodeStatus.PENDING,
        lastSeenAt: null,
        workerHostname: null,
        workerVersion: null,
        workerCpu: null,
        workerRam: null,
        activeChannels: 0,
      },
    });
  }

  async workerHeartbeat(secretKey: string, payload: WorkerHeartbeatInput) {
    const node = await prisma.boostNode.findUnique({ where: { secretKey } });
    if (!node) throw new AppError('Invalid Boost node key', 401);

    const cpu =
      typeof payload.cpu === 'number' && Number.isFinite(payload.cpu)
        ? Math.max(0, Math.min(payload.cpu, 100))
        : null;
    const ram =
      typeof payload.ram === 'number' && Number.isFinite(payload.ram)
        ? Math.max(0, Math.min(payload.ram, 100))
        : null;
    const activeChannels =
      typeof payload.activeChannels === 'number' && Number.isFinite(payload.activeChannels)
        ? Math.max(0, Math.floor(payload.activeChannels))
        : 0;

    const updated = await prisma.boostNode.update({
      where: { id: node.id },
      data: {
        status: BoostNodeStatus.ONLINE,
        lastSeenAt: new Date(),
        workerHostname: payload.hostname?.trim() || node.workerHostname,
        workerVersion: payload.version?.trim() || node.workerVersion,
        workerCpu: cpu,
        workerRam: ram,
        activeChannels,
      },
    });

    return {
      nodeId: updated.id,
      name: updated.name,
      encode: updated.encode,
      stream: updated.stream,
      maxChannels: updated.maxChannels,
      message: 'Connected to KurdLogs Boost',
    };
  }

  async markStaleNodesOffline() {
    const cutoff = new Date(Date.now() - STALE_AFTER_MS);
    const result = await prisma.boostNode.updateMany({
      where: {
        status: BoostNodeStatus.ONLINE,
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }],
      },
      data: { status: BoostNodeStatus.OFFLINE },
    });

    if (result.count > 0) {
      logger.info(`Marked ${result.count} Boost node(s) offline (stale heartbeat)`);
    }
  }
}

export const boostService = new BoostService();
