// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/query-client', () => ({ getQueryClient: () => ({ clear: vi.fn() }) }));
vi.mock('@/lib/hooks/use-external-urls', () => ({ invalidateExternalUrls: vi.fn() }));
vi.mock('@/lib/client-cache', () => ({
  broadcastAuthenticationBoundary: vi.fn(),
  clearUserScopedBrowserCaches: vi.fn(async () => {}),
  requestSessionLogout: vi.fn(),
}));

import { completeBrowserSignIn } from './client-sign-in';
import { useUIStore } from './store';

describe('completeBrowserSignIn', () => {
  it("drops the previous account's recent searches, which stay on the device", async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    // An admin searched Torrents for a magnet; a member then signs in on the same phone.
    useUIStore.getState().addSearchTerm('torrents', 'magnet:?xt=urn:btih:dd8255ec&tr=udp%3A%2F%2Ftracker.example%3A1337');
    expect(useUIStore.getState().searchHistory.torrents).toHaveLength(1);
    await completeBrowserSignIn();
    expect(useUIStore.getState().searchHistory).toEqual({});
  });
});
