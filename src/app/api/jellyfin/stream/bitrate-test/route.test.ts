import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireUserCapability: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));

import { GET } from './route';

const get = (query = '') => GET(new NextRequest(`http://localhost/api/jellyfin/stream/bitrate-test${query}`));
const member = (jellyfinToken: string | null) => ({ ok: true, user: { id: 'u1', jellyfinToken }, session: {} });

beforeEach(() => { vi.clearAllMocks(); });

it('needs the playback capability', async () => {
  mocks.requireUserCapability.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
  expect((await get()).status).toBe(403);
  expect(mocks.requireUserCapability).toHaveBeenCalledWith('jellyfin.view');
});

it('sends nothing to a member with no Jellyfin account linked', async () => {
  mocks.requireUserCapability.mockResolvedValue(member(null));
  const res = await get();
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: 'jellyfin_connect_required' });
});

it('serves the size asked for, within its bounds, uncached', async () => {
  mocks.requireUserCapability.mockResolvedValue(member('enc:token'));
  const res = await get('?size=500000');
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect((await res.arrayBuffer()).byteLength).toBe(500_000);
  expect((await (await get('?size=99999999')).arrayBuffer()).byteLength).toBe(1_000_000);
  expect((await (await get('?size=1')).arrayBuffer()).byteLength).toBe(64_000);
});
