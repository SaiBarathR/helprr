import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// /api/admin/arr-system/*: one Sonarr/Radarr/Lidarr/Prowlarr instance's
// version, scheduled tasks (with Run now) and recent log, for admins only.
// Which instance each reaches, which tasks may run, and what of the app's
// answer is passed on (rebuilt and redacted).

const API_KEY = '0123456789abcdef0123456789abcdef';

const mocks = vi.hoisted(() => ({
  role: 'admin',
  connections: {} as Record<string, { id: string; type: string; url: string; apiKey: string }>,
  getClient: vi.fn(),
  client: {
    getSystemStatus: vi.fn(),
    getUpdates: vi.fn(),
    getSystemTasks: vi.fn(),
    getLogs: vi.fn(),
    runTask: vi.fn(),
    getCommand: vi.fn(),
  },
  prowlarrBuilt: vi.fn(),
  invalidate: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAdmin: async () => (mocks.role === 'admin'
    ? { ok: true, user: { id: 'admin', username: 'admin', role: 'admin' } }
    : { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }),
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/logger')>()),
  logger: { info: mocks.logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db', () => ({
  prisma: { serviceConnection: { findUnique: async ({ where }: { where: { id: string } }) => mocks.connections[where.id] ?? null } },
}));
vi.mock('@/lib/service-helpers', () => {
  const client = (type: string) => async (instanceId: string) => {
    mocks.getClient(type, instanceId);
    return mocks.client;
  };
  return { getSonarrClient: client('SONARR'), getRadarrClient: client('RADARR'), getLidarrClient: client('LIDARR') };
});
vi.mock('@/lib/prowlarr-client', () => ({
  ProwlarrClient: function ProwlarrClient(url: string) {
    mocks.prowlarrBuilt(url);
    return mocks.client;
  },
}));
vi.mock('@/lib/service-connection-secrets', () => ({ getConnectionHeaders: () => undefined }));
vi.mock('@/lib/cache/tagged-library', () => ({ invalidateOnCommandComplete: mocks.invalidate }));

import { GET as statusGet } from '@/app/api/admin/arr-system/status/route';
import { GET as tasksGet, POST as tasksPost } from '@/app/api/admin/arr-system/tasks/route';
import { GET as commandGet } from '@/app/api/admin/arr-system/tasks/[id]/route';
import { GET as logsGet } from '@/app/api/admin/arr-system/logs/route';

const req = (path: string, init?: { method?: string; body?: unknown }) => new NextRequest(`http://localhost${path}`, {
  method: init?.method ?? 'GET',
  ...(init?.body !== undefined && { body: JSON.stringify(init.body), headers: { 'Content-Type': 'application/json' } }),
});
const run = (instanceId: string, name: unknown) =>
  tasksPost(req(`/api/admin/arr-system/tasks?instanceId=${instanceId}`, { method: 'POST', body: { name } }));
const command = (instanceId: string, id: string) =>
  commandGet(req(`/api/admin/arr-system/tasks/${id}?instanceId=${instanceId}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'admin';
  mocks.connections = {
    'son-1': { id: 'son-1', type: 'SONARR', url: 'http://sonarr:8989', apiKey: API_KEY },
    'rad-1': { id: 'rad-1', type: 'RADARR', url: 'http://radarr:7878', apiKey: API_KEY },
    'lid-1': { id: 'lid-1', type: 'LIDARR', url: 'http://lidarr:8686', apiKey: API_KEY },
    'pro-1': { id: 'pro-1', type: 'PROWLARR', url: 'http://prowlarr:9696', apiKey: API_KEY },
    'qbt-1': { id: 'qbt-1', type: 'QBITTORRENT', url: 'http://qbt:8080', apiKey: '' },
  };
  mocks.client.getSystemStatus.mockResolvedValue({ version: '4.0.20.3014', branch: 'main', appData: '/config', startupPath: '/app' });
  mocks.client.getUpdates.mockResolvedValue([
    { version: '4.0.21.3100', latest: true, installed: false, url: 'https://github.com/x.tar.gz' },
    { version: '4.0.20.3014', latest: false, installed: true },
  ]);
  mocks.client.getSystemTasks.mockResolvedValue([]);
  mocks.client.getLogs.mockResolvedValue({ records: [], totalRecords: 0 });
  mocks.client.runTask.mockResolvedValue({ id: 42, name: 'CheckHealth', status: 'queued', body: { secret: 'x' } });
  mocks.client.getCommand.mockResolvedValue({ id: 42, name: 'RefreshSeries', status: 'completed', body: { x: 1 } });
});

describe('admin only', () => {
  const calls: Array<[string, () => Promise<Response>]> = [
    ['status', () => statusGet(req('/api/admin/arr-system/status?instanceId=son-1'))],
    ['tasks', () => tasksGet(req('/api/admin/arr-system/tasks?instanceId=son-1'))],
    ['run', () => run('son-1', 'CheckHealth')],
    ['command', () => command('son-1', '42')],
    ['logs', () => logsGet(req('/api/admin/arr-system/logs?instanceId=son-1'))],
  ];
  it.each(calls)('%s is refused to a member, asking the app nothing', async (_name, call) => {
    mocks.role = 'member';
    expect((await call()).status).toBe(403);
    expect(mocks.getClient).not.toHaveBeenCalled();
    for (const fn of Object.values(mocks.client)) expect(fn).not.toHaveBeenCalled();
  });
});

describe('instance validation', () => {
  it.each([
    ['no instance', '', 400],
    ['a blank instance', '%20', 400],
    ['an overlong instance', 'x'.repeat(129), 400],
    ['an unknown instance', 'nope', 404],
    ['an instance of another kind', 'qbt-1', 404],
  ])('refuses %s', async (_label, instanceId, status) => {
    for (const res of [
      await statusGet(req(`/api/admin/arr-system/status?instanceId=${instanceId}`)),
      await tasksGet(req(`/api/admin/arr-system/tasks?instanceId=${instanceId}`)),
      await run(instanceId, 'CheckHealth'),
      await command(instanceId, '42'),
      await logsGet(req(`/api/admin/arr-system/logs?instanceId=${instanceId}`)),
    ]) expect(res.status).toBe(status);
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.prowlarrBuilt).not.toHaveBeenCalled();
  });

  it.each([['son-1', 'SONARR'], ['rad-1', 'RADARR'], ['lid-1', 'LIDARR']])('reaches %s as its own app', async (instanceId, type) => {
    expect((await statusGet(req(`/api/admin/arr-system/status?instanceId=${instanceId}`))).status).toBe(200);
    expect(mocks.getClient).toHaveBeenCalledWith(type, instanceId);
  });

  it("builds Prowlarr's client from the row named", async () => {
    expect((await statusGet(req('/api/admin/arr-system/status?instanceId=pro-1'))).status).toBe(200);
    expect(mocks.prowlarrBuilt).toHaveBeenCalledWith('http://prowlarr:9696');
    expect(mocks.getClient).not.toHaveBeenCalled();
  });
});

describe('GET status', () => {
  it('passes on the version, branch and offered update only', async () => {
    const res = await statusGet(req('/api/admin/arr-system/status?instanceId=son-1'));
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ version: '4.0.20.3014', branch: 'main', updateVersion: '4.0.21.3100', updateChecked: true });
  });

  it('offers no update when the latest is installed', async () => {
    mocks.client.getUpdates.mockResolvedValue([{ version: '4.0.20.3014', latest: true, installed: true }]);
    expect((await (await statusGet(req('/api/admin/arr-system/status?instanceId=son-1'))).json()).updateVersion).toBeNull();
  });

  it('says the check could not be made when the update list is empty', async () => {
    mocks.client.getUpdates.mockResolvedValue([]);
    expect((await (await statusGet(req('/api/admin/arr-system/status?instanceId=son-1'))).json()).updateChecked).toBe(false);
  });

  it('still answers with the version when the update list fails', async () => {
    mocks.client.getUpdates.mockRejectedValue(new Error('services.sonarr.tv unreachable'));
    expect(await (await statusGet(req('/api/admin/arr-system/status?instanceId=son-1'))).json())
      .toEqual({ version: '4.0.20.3014', branch: 'main', updateVersion: null, updateChecked: false });
  });

  it('drops a version that is not a version', async () => {
    mocks.client.getSystemStatus.mockResolvedValue({ version: '<img src=x>', branch: 'main' });
    mocks.client.getUpdates.mockResolvedValue([{ version: 'http://evil/?apikey=1', latest: true, installed: false }]);
    expect(await (await statusGet(req('/api/admin/arr-system/status?instanceId=son-1'))).json())
      .toEqual({ version: '', branch: 'main', updateVersion: null, updateChecked: true });
  });
});

describe('GET tasks', () => {
  it('rebuilds each task and marks only allowed ones runnable', async () => {
    mocks.client.getSystemTasks.mockResolvedValue([
      { name: 'Application Update Check', taskName: 'ApplicationUpdateCheck', interval: 360, lastExecution: '2026-11-24T13:47:55Z', nextExecution: '2026-11-24T19:47:55Z', lastDuration: '00:00:00.1915612', id: 3 },
      { name: 'Rss Sync', taskName: 'RssSync', interval: 15, lastExecution: '0001-01-01T00:00:00Z', lastDuration: '1.02:03:04.5', extra: 'x' },
      { name: 'Clean Up Recycle Bin', taskName: 'CleanUpRecycleBin', interval: 1440 },
      { name: 'Broken', taskName: 'Not a/name' },
    ]);
    const res = await tasksGet(req('/api/admin/arr-system/tasks?instanceId=son-1'));
    expect(await res.json()).toEqual([
      {
        taskName: 'ApplicationUpdateCheck',
        name: 'Application Update Check',
        intervalMinutes: 360,
        lastExecution: '2026-11-24T13:47:55.000Z',
        nextExecution: '2026-11-24T19:47:55.000Z',
        lastDurationSeconds: 0.1915612,
        canRun: false,
      },
      {
        taskName: 'RssSync',
        name: 'Rss Sync',
        intervalMinutes: 15,
        lastExecution: null,
        nextExecution: null,
        lastDurationSeconds: 93_784.5,
        canRun: true,
      },
      {
        taskName: 'CleanUpRecycleBin',
        name: 'Clean Up Recycle Bin',
        intervalMinutes: 1440,
        lastExecution: null,
        nextExecution: null,
        lastDurationSeconds: null,
        canRun: false,
      },
    ]);
  });
});

describe('POST tasks (Run now)', () => {
  it('refuses a text/plain post, which a form on another site can send', async () => {
    const res = await tasksPost(new NextRequest('http://localhost/api/admin/arr-system/tasks?instanceId=rad-1', {
      method: 'POST', body: JSON.stringify({ name: 'CheckHealth' }), headers: { 'Content-Type': 'text/plain' },
    }));
    expect(res.status).toBe(415);
    expect(mocks.client.runTask).not.toHaveBeenCalled();
  });

  it('runs an allowed task on the instance named and passes on only id, name and status', async () => {
    const res = await run('rad-1', 'CheckHealth');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 42, name: 'CheckHealth', status: 'queued' });
    expect(mocks.getClient).toHaveBeenCalledWith('RADARR', 'rad-1');
    expect(mocks.client.runTask).toHaveBeenCalledWith('CheckHealth');
    expect(mocks.logInfo).toHaveBeenCalledWith('Scheduled task run now', expect.objectContaining({
      userId: 'admin', instanceId: 'rad-1', command: 'CheckHealth', commandId: 42,
    }), { scope: 'radarr' });
  });

  it.each([
    ['son-1', 'ApplicationUpdateCheck'],
    ['rad-1', 'ApplicationCheckUpdate'],
    ['son-1', 'ApplicationUpdate'],
    ['son-1', 'CleanUpRecycleBin'],
    ['son-1', 'ImportListSync'],
    ['son-1', 'DeleteLogFiles'],
    ['son-1', 'ManualImport'],
    ['son-1', 'RefreshMovie'], // Radarr's, not Sonarr's
    ['lid-1', 'RescanFolders'],
    ['pro-1', 'CleanUpHistory'],
    ['pro-1', 'ClearHistory'],
    ['pro-1', 'ApplicationUpdateCheck'],
  ])('refuses %s %s and sends nothing', async (instanceId, name) => {
    const res = await run(instanceId, name);
    expect(res.status).toBe(400);
    expect(mocks.client.runTask).not.toHaveBeenCalled();
  });

  it.each([[undefined], [''], [42], [['CheckHealth']]])('refuses a name of %j', async (name) => {
    expect((await run('son-1', name)).status).toBe(400);
    expect(mocks.client.runTask).not.toHaveBeenCalled();
  });

  it.each([
    ['son-1', 'RefreshSeries'],
    ['rad-1', 'RefreshCollections'],
    ['lid-1', 'RefreshArtist'],
    ['pro-1', 'CheckHealth'],
    ['pro-1', 'ApplicationIndexerSync'],
  ])('allows %s %s', async (instanceId, name) => {
    expect((await run(instanceId, name)).status).toBe(200);
    expect(mocks.client.runTask).toHaveBeenCalledWith(name);
  });
});

describe('GET tasks/[id]', () => {
  it("follows the run on the instance named, and a finished refresh drops Helprr's library cache", async () => {
    const res = await command('son-1', '42');
    expect(await res.json()).toEqual({ id: 42, name: 'RefreshSeries', status: 'completed' });
    expect(mocks.client.getCommand).toHaveBeenCalledWith(42);
    expect(mocks.invalidate).toHaveBeenCalledWith('sonarr', { id: 42, name: 'RefreshSeries', status: 'completed' }, 'son-1');
  });

  it('has no library cache to drop for Prowlarr', async () => {
    expect((await command('pro-1', '42')).status).toBe(200);
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', 'abc', '99999999999'])('refuses command id %s', async (id) => {
    expect((await command('son-1', id)).status).toBe(400);
    expect(mocks.client.getCommand).not.toHaveBeenCalled();
  });
});

describe('GET logs', () => {
  it('asks for warnings and worse, newest first, a page at a time', async () => {
    await logsGet(req('/api/admin/arr-system/logs?instanceId=son-1&page=3'));
    expect(mocks.client.getLogs).toHaveBeenCalledWith({ page: 3, pageSize: 50, level: 'warn' });
    await logsGet(req('/api/admin/arr-system/logs?instanceId=son-1&level=error'));
    expect(mocks.client.getLogs).toHaveBeenLastCalledWith({ page: 1, pageSize: 50, level: 'error' });
  });

  it.each([['page=0', 1], ['page=-1', 1], ['page=abc', 1], ['page=99999', 1000]])('bounds %s', async (query, page) => {
    await logsGet(req(`/api/admin/arr-system/logs?instanceId=son-1&${query}`));
    expect(mocks.client.getLogs).toHaveBeenCalledWith({ page, pageSize: 50, level: 'warn' });
  });

  it.each([['level=info'], ['level=debug'], ['level=']])('refuses %s', async (query) => {
    expect((await logsGet(req(`/api/admin/arr-system/logs?instanceId=son-1&${query}`))).status).toBe(400);
    expect(mocks.client.getLogs).not.toHaveBeenCalled();
  });

  it('rebuilds each entry from its fields and redacts every secret', async () => {
    mocks.client.getLogs.mockResolvedValue({
      page: 1,
      pageSize: 50,
      totalRecords: 2,
      records: [
        {
          id: 7,
          time: '2026-11-24T17:45:57Z',
          level: 'warn',
          logger: 'Torznab',
          message: [
            'Indexer failed: http://prowlarr:9696/1/api?t=caps&apikey=SECRETAPIKEY123 (429)',
            'tracker https://tracker.example/announce/PASSKEYPATH9876/x',
            'magnet:?xt=urn:btih:abc&dn=Show Name S01&tr=udp%3A%2F%2Ftracker.example%3A80%2FPASSKEYMAG',
            'qbit http://admin:hunter2pass@qbt:8080/api/v2/auth',
            `bare key ${API_KEY} and other app key fedcba9876543210fedcba9876543210`,
            'apikey=LOOSEKEY555',
          ].join('\n'),
          exception: 'System.Net.WebException: http://user:pw2secret@host/x?passkey=EXPASS111\n   at Foo.Bar()',
          exceptionType: 'System.Net.WebException',
          method: 'Fetch',
          extra: 'not passed on',
        },
        { id: 8, time: 'not a time', level: 'warn', message: 'dropped' },
      ],
    });
    const res = await logsGet(req('/api/admin/arr-system/logs?instanceId=son-1'));
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await res.json();
    expect(body.totalRecords).toBe(2);
    expect(body.entries).toHaveLength(1);
    const [entry] = body.entries;
    expect(Object.keys(entry).sort()).toEqual(['exception', 'id', 'level', 'logger', 'message', 'time']);
    const text = `${entry.message}\n${entry.exception}`;
    for (const secret of [
      'SECRETAPIKEY123', 'PASSKEYPATH9876', 'PASSKEYMAG', 'Show Name', 'hunter2pass', 'admin:',
      API_KEY, 'fedcba9876543210fedcba9876543210', 'LOOSEKEY555', 'pw2secret', 'EXPASS111',
    ]) expect(text).not.toContain(secret);
    expect(entry.message).toContain('http://prowlarr:9696');
    expect(entry.message).toContain('https://tracker.example');
    expect(entry.message).toContain('magnet:[REDACTED]');
    expect(entry.message).toContain('http://qbt:8080');
    expect(entry.exception).toContain('at Foo.Bar()');
    expect(entry.time).toBe('2026-11-24T17:45:57.000Z');
  });

  it('cuts a long message after redacting it, so a key across the cut leaves nothing behind', async () => {
    // The 32-hex key starts at 1990 and runs past the 2000-character cut:
    // cut first, its first ten characters would stay, no longer a whole key.
    const long = `${'x'.repeat(1989)} fedcba9876543210fedcba9876543210 ${'y'.repeat(5000)}`;
    mocks.client.getLogs.mockResolvedValue({ totalRecords: 1, records: [{ id: 1, time: '2026-11-24T17:45:57Z', level: 'error', logger: 'L', message: long }] });
    const [entry] = (await (await logsGet(req('/api/admin/arr-system/logs?instanceId=son-1'))).json()).entries;
    expect(entry.message.length).toBeLessThanOrEqual(2001);
    expect(entry.message).not.toContain('fedcba98');
    expect(entry.level).toBe('error');
  });

  it.each([
    ['a URL glued to the word before it', 'foo_https://tracker.example/announce/PASSKEY1/x', 'PASSKEY1'],
    ['a URL glued to a number', 'Error 404https://tracker.example/rss/PASSKEY2', 'PASSKEY2'],
    ['credentials without a scheme', 'Connecting to admin:hunter2pw@192.168.1.5:8080', 'hunter2pw'],
    ['a percent-encoded URL', 'url=https%3A%2F%2Ftracker.example%2Fannounce%2FPASSKEY5', 'PASSKEY5'],
    ['a password field', 'Password: hunter4pw', 'hunter4pw'],
    ['a JSON password', '{"password":"hunter3pw"}', 'hunter3pw'],
    ['a JSON api key', '{"apiKey": "NOTHEXKEY777"}', 'NOTHEXKEY777'],
    ['an api_key field', 'api_key: NOTHEXKEY888', 'NOTHEXKEY888'],
  ])('redacts %s', async (_label, message, secret) => {
    mocks.client.getLogs.mockResolvedValue({ totalRecords: 1, records: [{ id: 1, time: '2026-11-24T17:45:57Z', level: 'warn', logger: 'L', message }] });
    const [entry] = (await (await logsGet(req('/api/admin/arr-system/logs?instanceId=son-1'))).json()).entries;
    expect(entry.message).not.toContain(secret);
  });

  it('redacts 50 pathological 28 KB entries quickly', async () => {
    const shapes = ['a.'.repeat(14_000), '//a:'.repeat(7_000), 'a'.repeat(28_000), 'a:b'.repeat(9_000), `${'x'.repeat(27_000)}://h/`];
    mocks.client.getLogs.mockResolvedValue({
      totalRecords: 50,
      records: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, time: '2026-11-24T17:45:57Z', level: 'warn', logger: 'L', message: shapes[i % shapes.length], exception: shapes[(i + 1) % shapes.length] })),
    });
    const started = performance.now();
    expect((await logsGet(req('/api/admin/arr-system/logs?instanceId=son-1'))).status).toBe(200);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
