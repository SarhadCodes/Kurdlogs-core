import { AppError } from '../middleware/errorHandler';

const MIN_LENGTH = 12;

export function assertStrongPassword(password: string, username?: string): void {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) {
    throw new AppError(`Password must be at least ${MIN_LENGTH} characters`, 400);
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new AppError(
      'Password must include uppercase, lowercase, and a number',
      400
    );
  }
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    throw new AppError('Password must not contain your username', 400);
  }
}

export const PASSWORD_MIN_LENGTH = MIN_LENGTH;
