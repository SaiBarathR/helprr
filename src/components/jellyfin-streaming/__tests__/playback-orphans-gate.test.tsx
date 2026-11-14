// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionProvider, type MePayload } from '@/components/permission-provider';
import { JellyfinPlaybackProvider } from '@/components/jellyfin-streaming/playback-provider';

const ORPHANS = '/api/jellyfin/stream/orphans';

function me(capabilities: MePayload['capabilities']): MePayload {
  return { id: 'u1', name: 'Member', role: 'member', template: 'member', capabilities } as MePayload;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const orphanCalls = () => fetchMock.mock.calls.filter(([url]) => url === ORPHANS);

// The startup sweep of this device's abandoned Jellyfin sessions is refused
// (403) without jellyfin.view, which printed a console error on every page.
describe('startup orphan sweep', () => {
  it('runs for a user who can use Jellyfin', () => {
    render(<PermissionProvider value={me({ 'jellyfin.view': true })}><JellyfinPlaybackProvider>{null}</JellyfinPlaybackProvider></PermissionProvider>);
    expect(orphanCalls()).toHaveLength(1);
  });

  it('is not sent without jellyfin.view', () => {
    render(<PermissionProvider value={me({ 'jellyfin.view': false })}><JellyfinPlaybackProvider>{null}</JellyfinPlaybackProvider></PermissionProvider>);
    expect(orphanCalls()).toHaveLength(0);
  });
});
