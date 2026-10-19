// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getJellyfinPlaybackDeviceId } from '@/lib/jellyfin-playback/device';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
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

  it('gives a tab its own id, kept in session storage, when local storage is refused', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const id = getJellyfinPlaybackDeviceId();
    expect(id).toMatch(/^helprr-pwa-.{8,}$/);
    expect(getJellyfinPlaybackDeviceId()).toBe(id);
    expect(window.sessionStorage.getItem('helprr-jellyfin-device-id')).toBe(id);
  });

  it('gives each tab its own id, held in memory, when all storage is refused', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    vi.resetModules();
    const first = (await import('@/lib/jellyfin-playback/device')).getJellyfinPlaybackDeviceId;
    const id = first();
    expect(id).toMatch(/^helprr-pwa-.{8,}$/);
    expect(first()).toBe(id);

    // Another tab loads the module afresh.
    vi.resetModules();
    const other = (await import('@/lib/jellyfin-playback/device')).getJellyfinPlaybackDeviceId;
    expect(other()).toMatch(/^helprr-pwa-.{8,}$/);
    expect(other()).not.toBe(id);
  });
});
