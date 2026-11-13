import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { can } from '@/lib/permissions';
import type { Capability } from '@/lib/capabilities';

// The Lidarr routes Activity's managers use (release search and grab, rename
// preview, commands, download clients) act on music: activity.manage alone is
// not enough, a manager also needs music.view. Real permission resolution.

const mocks = vi.hoisted(() => ({
  user: {} as Record<string, unknown>,
  lidarr: {
    getReleases: vi.fn(async () => []),
    grabRelease: vi.fn(async () => undefined),
    getRenamePreview: vi.fn(async () => []),
    searchAlbums: vi.fn(async () => ({ id: 1 })),
    getCommand: vi.fn(async () => ({ id: 1, status: 'completed' })),
    getDownloadClients: vi.fn(async () => []),
  },
}));

vi.mock('@/lib/auth', () => {
  const gate = (caps: readonly Capability[]) => (caps.every((cap) => can(mocks.user as never, cap))
    ? { ok: true, user: mocks.user, session: {} }
    : { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
  return {
    requireUserCapability: async (cap: Capability) => gate([cap]),
    requireUserAllCapabilities: async (caps: readonly Capability[]) => gate(caps),
  };
});
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/service-helpers', () => ({ getLidarrClient: async () => mocks.lidarr }));
vi.mock('@/lib/cache/tagged-library', () => ({ invalidateOnCommandComplete: vi.fn(), MUTATING_COMMANDS: new Set() }));

import { GET as releases, POST as grab } from './release/route';
import { GET as renamePreview } from './rename/route';
import { POST as command } from './command/route';
import { GET as commandStatus } from './command/[id]/route';
import { GET as downloadClients } from './downloadclient/route';

const ADMIN = { id: 'admin', role: 'admin', template: 'admin', permissions: {} };
const MANAGER = { id: 'manager', role: 'member', template: 'member', permissions: { 'activity.manage': true } };
const NO_MUSIC = { id: 'no-music', role: 'member', template: 'member', permissions: { 'activity.manage': true, 'music.view': false } };

const url = (path: string) => `http://localhost/api/lidarr/${path}`;
const calls = [
  ['release search', () => releases(new NextRequest(url('release?albumId=4&instanceId=lid-1')))],
  ['release grab', () => grab(new NextRequest(url('release?instanceId=lid-1'), { method: 'POST', body: JSON.stringify({ guid: 'g', indexerId: 2 }) }))],
  ['rename preview', () => renamePreview(new NextRequest(url('rename?artistId=3&instanceId=lid-1')))],
  ['album search', () => command(new NextRequest(url('command?instanceId=lid-1'), { method: 'POST', body: JSON.stringify({ name: 'AlbumSearch', albumIds: [4] }) }))],
  ['command status', () => commandStatus(new NextRequest(url('command/1?instanceId=lid-1')), { params: Promise.resolve({ id: '1' }) })],
  ['download clients', () => downloadClients(new NextRequest(url('downloadclient?instanceId=lid-1')))],
] as const;

beforeEach(() => vi.clearAllMocks());

describe.each(calls)('Lidarr %s', (_name, call) => {
  it.each([['an admin', ADMIN], ['a manager with music.view', MANAGER]])('is allowed for %s', async (_label, user) => {
    mocks.user = user;
    expect((await call()).status).toBe(200);
  });

  it('is refused to a manager without music.view, asking Lidarr nothing', async () => {
    mocks.user = NO_MUSIC;
    expect((await call()).status).toBe(403);
    for (const fn of Object.values(mocks.lidarr)) expect(fn).not.toHaveBeenCalled();
  });
});
