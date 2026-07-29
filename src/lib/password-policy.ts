export const LOCAL_PASSWORD_MIN_LENGTH = 15;
export const LOCAL_PASSWORD_MAX_BYTES = 1024;

export function countPasswordCodePoints(password: string): number {
  return Array.from(password).length;
}

function countUtf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function localPasswordValidationError(password: string): string | null {
  if (countPasswordCodePoints(password) < LOCAL_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${LOCAL_PASSWORD_MIN_LENGTH} characters`;
  }
  if (countUtf8Bytes(password) > LOCAL_PASSWORD_MAX_BYTES) {
    return `Password must be at most ${LOCAL_PASSWORD_MAX_BYTES} bytes`;
  }
  return null;
}
