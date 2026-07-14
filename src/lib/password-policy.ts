export const LOCAL_PASSWORD_MIN_LENGTH = 15;

export function countPasswordCodePoints(password: string): number {
  return Array.from(password).length;
}

export function localPasswordValidationError(password: string): string | null {
  if (countPasswordCodePoints(password) < LOCAL_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${LOCAL_PASSWORD_MIN_LENGTH} characters`;
  }
  return null;
}
