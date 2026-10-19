import { TICKS_PER_SECOND } from '@/types/jellyfin-streaming';

export function ticksToSeconds(ticks: number | undefined | null): number {
  if (!ticks || ticks <= 0) return 0;
  return ticks / TICKS_PER_SECOND;
}

export function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.floor(seconds * TICKS_PER_SECOND));
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const DEVICE_KEY = 'helprr-jellyfin-device-id';

// Jellyfin keeps one device record per id and hands it to whoever signed in
// last, so a browser that refuses storage (some private modes) must not fall
// back to an id shared with other people: it gets one of its own for the tab.
let tabDeviceId: string | null = null;

function newDeviceId(): string {
  // crypto.randomUUID() only exists in secure contexts. On a plain-http
  // install it would throw, so fall back to getRandomValues.
  const random = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `helprr-pwa-${random}`;
}

function storedDeviceId(storage: Storage): string {
  const existing = storage.getItem(DEVICE_KEY);
  if (existing && existing.length >= 8) return existing;
  const created = newDeviceId();
  storage.setItem(DEVICE_KEY, created);
  return created;
}

export function getJellyfinPlaybackDeviceId(): string {
  if (typeof window === 'undefined') return 'helprr-pwa';
  // Once this page has fallen back it keeps that id, even if local storage
  // works again later: a playback session must report under one device.
  if (tabDeviceId) return tabDeviceId;
  try {
    return storedDeviceId(window.localStorage);
  } catch {
    // Kept in the tab's session storage when it allows that, so a reload is
    // still the same device; otherwise in memory for this page.
    try {
      tabDeviceId = storedDeviceId(window.sessionStorage);
    } catch {
      tabDeviceId = newDeviceId();
    }
    return tabDeviceId;
  }
}

export function getJellyfinPlaybackDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Helprr';
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'Helprr iPad';
  if (/iPhone/.test(ua)) return 'Helprr iPhone';
  if (/Android/.test(ua)) return 'Helprr Android';
  if (/Mac/.test(ua)) return 'Helprr Mac';
  return 'Helprr';
}
