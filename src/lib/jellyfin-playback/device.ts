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

export function getJellyfinPlaybackDeviceId(): string {
  if (typeof window === 'undefined') return 'helprr-pwa';
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing && existing.length >= 8) return existing;
    const created = `helprr-pwa-${crypto.randomUUID()}`;
    window.localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return 'helprr-pwa';
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
