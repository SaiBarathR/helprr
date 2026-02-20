export function isProtectedApiImageSrc(src: string): boolean {
  try {
    const parsed = new URL(src, 'http://localhost');
    return parsed.pathname === '/api/jellyfin/image';
  } catch {
    return false;
  }
}
