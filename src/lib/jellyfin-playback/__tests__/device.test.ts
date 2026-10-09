// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getJellyfinPlaybackDeviceId } from '@/lib/jellyfin-playback/device';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getJellyfinPlaybackDeviceId', () => {
  it('gives a browser its own id and keeps it', () => {
    const id = getJellyfinPlaybackDeviceId();
    expect(id).toMatch(/^helprr-pwa-.{8,}$/);
    expect(getJellyfinPlaybackDeviceId()).toBe(id);
  });

  // A self-hosted install opened over plain http has no crypto.randomUUID.
  it('still gives each browser its own id outside a secure context', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });

    const id = getJellyfinPlaybackDeviceId();
    expect(id).toMatch(/^helprr-pwa-[0-9a-f]{32}$/);
    expect(getJellyfinPlaybackDeviceId()).toBe(id);

    window.localStorage.clear();
    expect(getJellyfinPlaybackDeviceId()).not.toBe(id);
  });

  it('falls back to the shared id only when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(getJellyfinPlaybackDeviceId()).toBe('helprr-pwa');
  });
});
