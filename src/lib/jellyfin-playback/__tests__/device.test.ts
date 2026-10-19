// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A fresh copy of the module is a new page: its per-page fallback starts empty.
async function loadPage() {
  vi.resetModules();
  return (await import('@/lib/jellyfin-playback/device')).getJellyfinPlaybackDeviceId;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getJellyfinPlaybackDeviceId', () => {
  it('gives a browser its own id and keeps it', async () => {
    const getJellyfinPlaybackDeviceId = await loadPage();
    const id = getJellyfinPlaybackDeviceId();
    expect(id).toMatch(/^helprr-pwa-.{8,}$/);
    expect(getJellyfinPlaybackDeviceId()).toBe(id);
  });

  // A self-hosted install opened over plain http has no crypto.randomUUID.
  it('still gives each browser its own id outside a secure context', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const getJellyfinPlaybackDeviceId = await loadPage();

    const id = getJellyfinPlaybackDeviceId();
    expect(id).toMatch(/^helprr-pwa-[0-9a-f]{32}$/);
    expect(getJellyfinPlaybackDeviceId()).toBe(id);

    window.localStorage.clear();
    expect(getJellyfinPlaybackDeviceId()).not.toBe(id);
  });

  it('gives a tab its own id, kept in session storage, when local storage is refused', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const id = (await loadPage())();
    expect(id).toMatch(/^helprr-pwa-.{8,}$/);
    expect(window.sessionStorage.getItem('helprr-jellyfin-device-id')).toBe(id);

    // A reload in the same tab reads it back.
    expect((await loadPage())()).toBe(id);
  });

  it('keeps the fallen-back id for the page when local storage works again', async () => {
    const realSetItem = Storage.prototype.setItem;
    let refuse = true;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (refuse && this === window.localStorage) throw new Error('quota exceeded');
      realSetItem.call(this, key, value);
    });
    const getJellyfinPlaybackDeviceId = await loadPage();
    const id = getJellyfinPlaybackDeviceId();
    expect(id).toMatch(/^helprr-pwa-.{8,}$/);

    refuse = false;
    expect(getJellyfinPlaybackDeviceId()).toBe(id);
    expect(window.localStorage.getItem('helprr-jellyfin-device-id')).toBeNull();
  });

  it('gives each tab its own id, held in memory, when all storage is refused', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const first = await loadPage();
    const id = first();
    expect(id).toMatch(/^helprr-pwa-.{8,}$/);
    expect(first()).toBe(id);

    // Another tab loads the module afresh.
    const other = await loadPage();
    expect(other()).toMatch(/^helprr-pwa-.{8,}$/);
    expect(other()).not.toBe(id);
  });
});
