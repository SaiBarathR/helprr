import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  qbit: {
    getSpeedLimits: vi.fn(),
    getSpeedLimitsMode: vi.fn(),
    setSpeedLimits: vi.fn(),
    toggleSpeedLimitsMode: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/service-helpers', () => ({ getQBittorrentClient: vi.fn().mockResolvedValue(mocks.qbit) }));
vi.mock('@/lib/cache/qbittorrent-version', () => ({ bumpQbitCacheVersion: vi.fn() }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { GET, POST } from '@/app/api/qbittorrent/transfer/limits/route';

const ADMIN = { id: 'u1', role: 'admin', template: 'admin', permissions: {} };
const FORBIDDEN = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
const get = GET as unknown as () => Promise<Response>;
const post = (body: unknown) =>
  (POST as unknown as (request: NextRequest) => Promise<Response>)(new NextRequest('http://localhost/api/qbittorrent/transfer/limits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
const upstreamCalls = () => Object.values(mocks.qbit).filter((fn) => fn.mock.calls.length > 0);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: ADMIN, session: {} });
  mocks.qbit.getSpeedLimits.mockResolvedValue({ dl_limit: 1_048_576, up_limit: 524_288, alt_dl_limit: 51_200, alt_up_limit: 20_480 });
  mocks.qbit.getSpeedLimitsMode.mockResolvedValue(1);
});

describe('GET /api/qbittorrent/transfer/limits', () => {
  it('returns both limit pairs and the mode, and nothing else', async () => {
    // Even if the client handed back more of the preferences, the route names its fields.
    mocks.qbit.getSpeedLimits.mockResolvedValue({
      dl_limit: 1_048_576, up_limit: 524_288, alt_dl_limit: 51_200, alt_up_limit: 20_480, web_ui_password: 'secret',
    });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      downloadLimit: 1_048_576,
      uploadLimit: 524_288,
      altDownloadLimit: 51_200,
      altUploadLimit: 20_480,
      speedLimitsMode: 1,
    });
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('torrents.view');
  });

  it('reads nothing upstream for a user without torrents.view', async () => {
    mocks.requireUserCapability.mockResolvedValue(FORBIDDEN);
    expect((await get()).status).toBe(403);
    expect(upstreamCalls()).toEqual([]);
  });
});

describe('POST /api/qbittorrent/transfer/limits', () => {
  it.each([
    ['setDownloadLimit', 'dl_limit'],
    ['setUploadLimit', 'up_limit'],
    ['setAltDownloadLimit', 'alt_dl_limit'],
    ['setAltUploadLimit', 'alt_up_limit'],
  ])('%s writes %s and only that key', async (action, key) => {
    const res = await post({ action, limit: 2_097_152, web_ui_password: 'pwned', autorun_program: 'rm -rf /', dl_limit: 1 });
    expect(res.status).toBe(200);
    expect(mocks.qbit.setSpeedLimits).toHaveBeenCalledExactlyOnceWith({ [key]: 2_097_152 });
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('torrents.bandwidth');
  });

  it('accepts 0 (unlimited) and the largest limit qBittorrent stores', async () => {
    expect((await post({ action: 'setAltDownloadLimit', limit: 0 })).status).toBe(200);
    expect((await post({ action: 'setAltDownloadLimit', limit: 2_147_483_647 })).status).toBe(200);
    expect(mocks.qbit.setSpeedLimits.mock.calls).toEqual([[{ alt_dl_limit: 0 }], [{ alt_dl_limit: 2_147_483_647 }]]);
  });

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['a string', '1024'],
    ['missing', undefined],
    ['null', null],
    ['too large', 2_147_483_648],
  ])('refuses a limit that is %s', async (_label, limit) => {
    const res = await post({ action: 'setDownloadLimit', limit });
    expect(res.status).toBe(400);
    expect(upstreamCalls()).toEqual([]);
  });

  it.each(['web_ui_password', 'autorun_program', 'setPreferences', 'constructor', '__proto__', 'toString'])(
    'refuses action %s without calling qBittorrent',
    async (action) => {
      const res = await post({ action, limit: 0 });
      expect(res.status).toBe(400);
      expect(upstreamCalls()).toEqual([]);
    },
  );

  it('refuses a body that is not JSON', async () => {
    expect((await post('{')).status).toBe(400);
    expect(upstreamCalls()).toEqual([]);
  });

  it('toggles alternative speed mode', async () => {
    expect((await post({ action: 'toggleSpeedLimitsMode' })).status).toBe(200);
    expect(mocks.qbit.toggleSpeedLimitsMode).toHaveBeenCalledOnce();
    expect(mocks.qbit.setSpeedLimits).not.toHaveBeenCalled();
  });

  it('changes nothing for a user without torrents.bandwidth', async () => {
    mocks.requireUserCapability.mockResolvedValue(FORBIDDEN);
    for (const body of [{ action: 'setAltDownloadLimit', limit: 0 }, { action: 'toggleSpeedLimitsMode' }]) {
      expect((await post(body)).status).toBe(403);
    }
    expect(upstreamCalls()).toEqual([]);
  });
});
