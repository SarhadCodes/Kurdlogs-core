import type { Request } from 'express';
import type { Socket } from 'socket.io';

function firstForwardedIp(forwarded: string | string[] | undefined): string | undefined {
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]).split(',')[0].trim();
  }
  return undefined;
}

export function getClientIp(socket: Socket): string {
  const forwarded = firstForwardedIp(socket.handshake.headers['x-forwarded-for']);
  if (forwarded) return forwarded.replace(/^::ffff:/, '');
  const addr = socket.handshake.address || '';
  return addr.replace(/^::ffff:/, '');
}

export function getRequestClientIp(req: Request): string {
  const forwarded = firstForwardedIp(req.headers['x-forwarded-for']);
  if (forwarded) return forwarded.replace(/^::ffff:/, '');
  const addr = req.socket?.remoteAddress || req.ip || '';
  return addr.replace(/^::ffff:/, '');
}
