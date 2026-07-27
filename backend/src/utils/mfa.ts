import { createHash, randomBytes } from 'crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import { env } from '../config/env';

export function generateMfaSecret(): string {
  return generateSecret();
}

export function buildMfaOtpauthUrl(username: string, secret: string): string {
  return generateURI({
    issuer: env.MFA_ISSUER,
    label: username,
    secret,
  });
}

export async function buildMfaQrDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
}

export function verifyTotp(secret: string, token: string): boolean {
  const code = String(token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return false;
  try {
    const result = verifySync({ secret, token: code, epochTolerance: 30 });
    return Boolean(result.valid);
  } catch {
    return false;
  }
}

export function hashBackupCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

export function generateBackupCodes(count = 8): { plain: string[]; hashed: string[] } {
  const plain: string[] = [];
  const hashed: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = randomBytes(4).toString('hex').toUpperCase();
    plain.push(code);
    hashed.push(hashBackupCode(code));
  }
  return { plain, hashed };
}

export function consumeBackupCode(
  storedJson: string | null | undefined,
  submitted: string
): string[] | null {
  if (!storedJson) return null;
  let hashes: string[];
  try {
    hashes = JSON.parse(storedJson) as string[];
  } catch {
    return null;
  }
  if (!Array.isArray(hashes)) return null;
  const target = hashBackupCode(submitted);
  const idx = hashes.indexOf(target);
  if (idx < 0) return null;
  return hashes.filter((_, i) => i !== idx);
}

/** MFA is recommended for privileged roles but not forced after install. */
export function rolesRequiringMfa(_role: string): boolean {
  return false;
}
