export const LOCAL_USERNAME_MAX_CODE_POINTS = 64;

export function normalizeLocalUsername(username: string): string {
  return username.trim();
}

export function localUsernameValidationError(username: string): string | null {
  const normalized = normalizeLocalUsername(username);
  if (!normalized) return 'Username is required';
  if (Array.from(normalized).length > LOCAL_USERNAME_MAX_CODE_POINTS) {
    return `Username must be at most ${LOCAL_USERNAME_MAX_CODE_POINTS} characters`;
  }
  return null;
}
