import * as zmq from 'zeromq';
import net from 'net';
import { logger } from '../../utils/logger';

/** Wait until FFmpeg zmq filter is accepting TCP connections. */
export async function waitForZmqPort(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
          socket.end();
          resolve();
        });
        socket.setTimeout(500);
        socket.on('timeout', () => {
          socket.destroy();
          reject(new Error('timeout'));
        });
        socket.on('error', reject);
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`zmq port ${port} not ready after ${timeoutMs}ms`);
}

/**
 * Send libavfilter commands to a running FFmpeg zmq filter endpoint.
 * FFmpeg uses ZeroMQ REP — plain TCP will hang/time out.
 * @see https://ffmpeg.org/ffmpeg-filters.html#zmq
 */
export async function sendFfmpegZmqCommands(
  port: number,
  commands: string[],
  timeoutMs = 5000
): Promise<void> {
  const sock = new zmq.Request({
    sendTimeout: timeoutMs,
    receiveTimeout: timeoutMs,
  });

  try {
    await sock.connect(`tcp://127.0.0.1:${port}`);
    for (const cmd of commands) {
      await sock.send(cmd);
      await sock.receive();
    }
    logger.info(`[MCR_SWITCHER] zmq port=${port} commands=${commands.join('; ')}`);
  } finally {
    sock.close();
  }
}

export async function switchStreamSelectMap(port: number, slotIndex: number): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await sendFfmpegZmqCommands(
        port,
        [`@vsel map ${slotIndex}`, `@asel map ${slotIndex}`],
        12_000
      );
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
