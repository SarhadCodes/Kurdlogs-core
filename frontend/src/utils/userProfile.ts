import type { User } from '../types';

export function userDisplayName(user: Pick<User, 'username' | 'displayName'> | null | undefined): string {
  const name = user?.displayName?.trim();
  if (name) return name;
  return user?.username || 'Operator';
}

export function userInitials(user: Pick<User, 'username' | 'displayName'> | null | undefined): string {
  const label = userDisplayName(user);
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return label.slice(0, 2).toUpperCase() || 'U';
}

export function resolveAvatarUrl(avatarUrl?: string | null): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://') || avatarUrl.startsWith('/')) {
    return avatarUrl;
  }
  return `/uploads/${avatarUrl.replace(/^uploads\//, '')}`;
}
