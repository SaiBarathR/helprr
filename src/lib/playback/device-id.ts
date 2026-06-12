// Stable per-browser DeviceId so each browser shows up as its own device in the
// Jellyfin dashboard and transcode sessions can be cleaned up per device.
// Browser-only (localStorage).

const STORAGE_KEY = 'helprr-device-id';

let inMemoryId: string | null = null;

export function getDeviceId(): string {
  if (inMemoryId) return inMemoryId;
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) {
      inMemoryId = existing;
      return existing;
    }
    const fresh = `helprr-web-${crypto.randomUUID()}`;
    localStorage.setItem(STORAGE_KEY, fresh);
    inMemoryId = fresh;
    return fresh;
  } catch {
    // localStorage unavailable (private mode) — fall back to a per-load id.
    inMemoryId = `helprr-web-${crypto.randomUUID()}`;
    return inMemoryId;
  }
}
