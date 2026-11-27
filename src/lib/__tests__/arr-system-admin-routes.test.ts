import { Readable } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// /api/admin/arr-system/power and /backups/*: restart or shut down one
// Sonarr/Radarr/Lidarr/Prowlarr instance, and its System → Backup (list, the
// file, restore, restore from a file, delete). Admins only; the backup steps
// also take the typed word and the admin's password, checked before the app
// is asked to do anything.

const mocks = vi.hoisted(() => ({
  role: 'admin',
  connections: {} as Record<string, { id: string; type: string; url: string; apiKey: string; label: string }>,
  getClient: vi.fn(),
  admin: {
    power: vi.fn(),
    getBackups: vi.fn(),
    deleteBackup: vi.fn(),
    restoreBackup: vi.fn(),
    restoreUploadedBackup: vi.fn(),
    downloadBackup: vi.fn(),
  },
  stepUp: vi.fn(),
  audit: vi.fn(),
  prowlarrBuilt: vi.fn(),
}));

const ADMIN = { id: 'admin', username: 'admin', role: 'admin' };

vi.mock('@/lib/auth', () => ({
  requireAdmin: async () => (mocks.role === 'admin'
    ? { ok: true, user: ADMIN }
    : { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }),
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/logger')>()),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db', () => ({
  prisma: { serviceConnection: { findUnique: async ({ where }: { where: { id: string } }) => mocks.connections[where.id] ?? null } },
}));
vi.mock('@/lib/service-helpers', () => {
  const client = (type: string) => async (instanceId: string) => {
    mocks.getClient(type, instanceId);
    return { systemAdmin: mocks.admin };
  };
  return { getSonarrClient: client('SONARR'), getRadarrClient: client('RADARR'), getLidarrClient: client('LIDARR') };
});
vi.mock('@/lib/prowlarr-client', () => ({
  ProwlarrClient: function ProwlarrClient(url: string) {
    mocks.prowlarrBuilt(url);
    return { systemAdmin: mocks.admin };
  },
}));
vi.mock('@/lib/service-connection-secrets', () => ({ getConnectionHeaders: () => undefined }));
vi.mock('@/lib/server/confirm-password', () => ({ confirmAdminStepUp: mocks.stepUp }));
vi.mock('@/lib/security-audit', () => ({
  recordSecurityEvent: mocks.audit,
  serviceTargetLabel: (type: string, label: string) => `${type} · ${label}`,
}));

import { POST as powerPost } from '@/app/api/admin/arr-system/power/route';
import { GET as backupsGet } from '@/app/api/admin/arr-system/backups/route';
import { DELETE as backupDelete } from '@/app/api/admin/arr-system/backups/[id]/route';
import { POST as restorePost } from '@/app/api/admin/arr-system/backups/[id]/restore/route';
import { POST as downloadPost } from '@/app/api/admin/arr-system/backups/[id]/download/route';
import { POST as uploadPost } from '@/app/api/admin/arr-system/backups/upload/route';
import { toBackups, uploadedBackupProblem, zipEntryNames } from '@/lib/server/arr-system';

/** An axios error with no answer (a timeout, a cut connection) or one that never reached the app. */
const noAnswer = (code: string) => Object.assign(new Error(code), { isAxiosError: true, code });

/** A stored (uncompressed) zip with these files, as the apps' backups are laid out. */
function makeZip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const n = enc.encode(name);
    const data = enc.encode(content);
    const local = new Uint8Array(30 + n.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, n.length, true);
    local.set(n, 30);
    local.set(data, 30 + n.length);
    const central = new Uint8Array(46 + n.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    central.set(n, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const BACKUPS = [
  { id: 111, name: 'sonarr_backup_v4.0.20.3014_2026.11.20_03.00.00.zip', path: '/backup/scheduled/sonarr_backup_v4.0.20.3014_2026.11.20_03.00.00.zip', type: 'scheduled', size: 725817, time: '2026-11-20T03:00:00Z' },
  { id: 222, name: 'sonarr_backup_v4.0.20.3014_2026.11.25_10.49.27.zip', path: '/backup/manual/sonarr_backup_v4.0.20.3014_2026.11.25_10.49.27.zip', type: 'manual', size: 16008, time: '2026-11-25T10:49:27Z' },
];

const json = (path: string, method: string, body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method,
  ...(body !== undefined && { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
});
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const FACTORS = { currentPassword: 'correct horse battery staple' };

const power = (instanceId: string, action: unknown) =>
  powerPost(json(`/api/admin/arr-system/power?instanceId=${instanceId}`, 'POST', { action }));
const list = (instanceId: string) => backupsGet(json(`/api/admin/arr-system/backups?instanceId=${instanceId}`, 'GET'));
const del = (instanceId: string, id: string, body: unknown = { ...FACTORS, confirm: 'DELETE' }) =>
  backupDelete(json(`/api/admin/arr-system/backups/${id}?instanceId=${instanceId}`, 'DELETE', body), ctx(id));
const restore = (instanceId: string, id: string, body: unknown = { ...FACTORS, confirm: 'RESTORE' }) =>
  restorePost(json(`/api/admin/arr-system/backups/${id}/restore?instanceId=${instanceId}`, 'POST', body), ctx(id));
const download = (instanceId: string, id: string, body: unknown = FACTORS) =>
  downloadPost(json(`/api/admin/arr-system/backups/${id}/download?instanceId=${instanceId}`, 'POST', body), ctx(id));

async function upload(
  instanceId: string,
  fields: { file?: Uint8Array | null; name?: string; confirm?: string } = {},
  headers: { length?: number | null } = {},
) {
  const form = new FormData();
  form.append('confirm', fields.confirm ?? 'RESTORE');
  form.append('currentPassword', FACTORS.currentPassword);
  if (fields.file !== null) {
    form.append('file', new Blob([(fields.file ?? makeZip({ 'config.xml': '<Config/>', 'sonarr.db': 'db' })) as BlobPart]), fields.name ?? 'b.zip');
  }
  const encoded = new Request('http://localhost', { method: 'POST', body: form });
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  const length = headers.length === undefined ? bytes.length : headers.length;
  return uploadPost(new NextRequest(`http://localhost/api/admin/arr-system/backups/upload?instanceId=${instanceId}`, {
    method: 'POST',
    body: bytes,
    headers: {
      'Content-Type': encoded.headers.get('content-type')!,
      ...(length !== null && { 'Content-Length': String(length) }),
    },
  }));
}

function upstreamCalls(): number {
  return Object.values(mocks.admin).reduce((sum, fn) => sum + fn.mock.calls.length, 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'admin';
  mocks.connections = {
    'son-1': { id: 'son-1', type: 'SONARR', url: 'http://sonarr:8989', apiKey: 'k', label: 'Sonarr' },
    'rad-1': { id: 'rad-1', type: 'RADARR', url: 'http://radarr:7878', apiKey: 'k', label: '4K' },
    'lid-1': { id: 'lid-1', type: 'LIDARR', url: 'http://lidarr:8686', apiKey: 'k', label: 'Lidarr' },
    'pro-1': { id: 'pro-1', type: 'PROWLARR', url: 'http://prowlarr:9696', apiKey: 'k', label: 'Prowlarr' },
    'qbt-1': { id: 'qbt-1', type: 'QBITTORRENT', url: 'http://qbt:8080', apiKey: '', label: 'qBittorrent' },
  };
  mocks.stepUp.mockResolvedValue(null);
  mocks.admin.power.mockResolvedValue(undefined);
  mocks.admin.getBackups.mockResolvedValue(BACKUPS);
  mocks.admin.deleteBackup.mockResolvedValue(undefined);
  mocks.admin.restoreBackup.mockResolvedValue(undefined);
  mocks.admin.restoreUploadedBackup.mockResolvedValue(undefined);
  mocks.admin.downloadBackup.mockResolvedValue({ stream: Readable.from([Buffer.from('PK zip bytes')]), contentType: 'application/x-zip-compressed' });
});

describe('admin only', () => {
  const calls: Array<[string, () => Promise<Response>]> = [
    ['restart', () => power('son-1', 'restart')],
    ['shutdown', () => power('son-1', 'shutdown')],
    ['list', () => list('son-1')],
    ['delete', () => del('son-1', '222')],
    ['restore', () => restore('son-1', '222')],
    ['download', () => download('son-1', '222')],
    ['upload', () => upload('son-1')],
  ];
  it.each(calls)('%s is refused to a member, asking the app nothing and checking no password', async (_name, call) => {
    mocks.role = 'member';
    expect((await call()).status).toBe(403);
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.prowlarrBuilt).not.toHaveBeenCalled();
    expect(mocks.stepUp).not.toHaveBeenCalled();
    expect(upstreamCalls()).toBe(0);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe('instance validation', () => {
  it.each([
    ['no instance', '', 400],
    ['an overlong instance', 'x'.repeat(129), 400],
    ['an unknown instance', 'nope', 404],
    ['an instance of another kind', 'qbt-1', 404],
  ])('refuses %s', async (_label, instanceId, status) => {
    for (const res of [
      await power(instanceId, 'restart'),
      await list(instanceId),
      await del(instanceId, '222'),
      await restore(instanceId, '222'),
      await download(instanceId, '222'),
      await upload(instanceId),
    ]) {
      expect(res.status).toBe(status);
    }
    expect(mocks.stepUp).not.toHaveBeenCalled();
    expect(upstreamCalls()).toBe(0);
  });

  it("reaches each app's own instance; Prowlarr is built from its row", async () => {
    await power('rad-1', 'restart');
    expect(mocks.getClient).toHaveBeenCalledWith('RADARR', 'rad-1');
    await power('lid-1', 'restart');
    expect(mocks.getClient).toHaveBeenCalledWith('LIDARR', 'lid-1');
    await power('pro-1', 'shutdown');
    expect(mocks.prowlarrBuilt).toHaveBeenCalledWith('http://prowlarr:9696');
  });
});

describe('restart and shut down', () => {
  it.each([undefined, '', 'update', 'Restart', 'restart ', ['restart']])('refuses the action %j', async (action) => {
    const res = await power('son-1', action);
    expect(res.status).toBe(400);
    expect(mocks.admin.power).not.toHaveBeenCalled();
  });

  it.each([
    ['restart', 'restarted'],
    ['shutdown', 'shut down'],
  ])('sends %s and records it in the security audit', async (action, field) => {
    const res = await power('rad-1', action);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(mocks.admin.power).toHaveBeenCalledWith(action);
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actor: ADMIN,
      action: 'SERVICE_UPDATED',
      targetType: 'service',
      targetId: 'rad-1',
      targetLabel: 'RADARR · 4K',
      fields: [field],
    }));
  });

  it('takes JSON only, so a form on another site cannot send it', async () => {
    const res = await powerPost(new NextRequest('http://localhost/api/admin/arr-system/power?instanceId=son-1', {
      method: 'POST',
      body: JSON.stringify({ action: 'shutdown' }),
      headers: { 'Content-Type': 'text/plain' },
    }));
    expect(res.status).toBe(415);
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.admin.power).not.toHaveBeenCalled();
  });

  it('records nothing when the app refuses', async () => {
    mocks.admin.power.mockRejectedValue(new Error('Request failed with status code 500'));
    expect((await power('son-1', 'restart')).status).toBe(500);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe('backup list', () => {
  it('passes on id, name, type, size and time only, newest first', async () => {
    const res = await list('son-1');
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = await res.json();
    expect(body).toEqual([
      { id: 222, name: BACKUPS[1].name, type: 'manual', size: 16008, time: '2026-11-25T10:49:27.000Z' },
      { id: 111, name: BACKUPS[0].name, type: 'scheduled', size: 725817, time: '2026-11-20T03:00:00.000Z' },
    ]);
    expect(JSON.stringify(body)).not.toContain('/backup/');
  });

  it('leaves out rows whose name or type is not the shape the apps write', () => {
    const rows = toBackups([
      { id: 1, name: '../../config.xml', type: 'manual', size: 1, time: '2026-11-25T10:49:27Z' },
      { id: 2, name: 'a/b.zip', type: 'manual', size: 1, time: '2026-11-25T10:49:27Z' },
      { id: 3, name: 'ok.zip', type: 'other', size: 1, time: '2026-11-25T10:49:27Z' },
      { id: 4, name: 'ok.zip', type: 'update', size: 1, time: 'never' },
      { id: '5', name: 'ok.zip', type: 'update', size: -3, time: '2026-11-25T10:49:27Z' },
      { id: 6.5, name: 'ok.zip', type: 'update', size: 1, time: '2026-11-25T10:49:27Z' },
      null,
    ]);
    expect(rows).toEqual([{ id: 5, name: 'ok.zip', type: 'update', size: 0, time: '2026-11-25T10:49:27.000Z' }]);
  });
});

describe.each([
  ['delete', (id: string, body?: unknown) => del('son-1', id, body)],
  ['restore', (id: string, body?: unknown) => restore('son-1', id, body)],
  ['download', (id: string, body?: unknown) => download('son-1', id, body)],
] as const)('%s', (name, call) => {
  it.each(['abc', '0', '-1', '1.5', '99999999999', '2147483648'])('refuses the id %s before the password', async (id) => {
    expect((await call(id)).status).toBe(400);
    expect(mocks.stepUp).not.toHaveBeenCalled();
    expect(upstreamCalls()).toBe(0);
  });

  it('stops at a refused password, asking the app nothing', async () => {
    mocks.stepUp.mockResolvedValue(NextResponse.json({ error: 'Current password is incorrect', field: 'currentPassword' }, { status: 403 }));
    const res = await call('222');
    expect(res.status).toBe(403);
    expect((await res.json()).field).toBe('currentPassword');
    expect(upstreamCalls()).toBe(0);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('says so when the backup is no longer listed', async () => {
    const res = await call('333');
    expect(res.status).toBe(404);
    expect(mocks.admin.getBackups).toHaveBeenCalledOnce();
    expect(upstreamCalls()).toBe(1);
  });

  it('asks for the password with the request body', async () => {
    await call('222');
    expect(mocks.stepUp).toHaveBeenCalledWith(
      expect.anything(),
      ADMIN,
      expect.objectContaining(FACTORS),
      `arr-backup-${name}`,
      expect.any(String),
    );
  });
});

describe('typed word', () => {
  it.each([undefined, '', 'delete please', 'RESTORE'])('delete refuses %j before the password', async (confirm) => {
    expect((await del('son-1', '222', { ...FACTORS, confirm })).status).toBe(400);
    expect(mocks.stepUp).not.toHaveBeenCalled();
    expect(upstreamCalls()).toBe(0);
  });

  it.each([undefined, '', 'restore', 'DELETE'])('restore refuses %j before the password', async (confirm) => {
    expect((await restore('son-1', '222', { ...FACTORS, confirm })).status).toBe(400);
    expect(mocks.stepUp).not.toHaveBeenCalled();
    expect(upstreamCalls()).toBe(0);
  });
});

describe('delete', () => {
  it('deletes the listed backup and records its name', async () => {
    const res = await del('son-1', '222');
    expect(res.status).toBe(200);
    expect(mocks.admin.deleteBackup).toHaveBeenCalledWith(222);
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'SERVICE_UPDATED',
      targetId: 'son-1',
      fields: [`backup deleted: ${BACKUPS[1].name}`],
    }));
  });
});

describe('delete without an answer', () => {
  it('records it and says the backup may be deleted', async () => {
    mocks.admin.deleteBackup.mockRejectedValue(noAnswer('ETIMEDOUT'));
    const res = await del('son-1', '222');
    expect(res.status).toBe(504);
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      fields: [`backup delete sent: ${BACKUPS[1].name} (no answer from the app)`],
    }));
  });
});

describe('restore', () => {
  it('restores, then restarts the app, as its own page does', async () => {
    const res = await restore('son-1', '111');
    expect(await res.json()).toEqual({ ok: true, restarted: true });
    expect(mocks.admin.restoreBackup).toHaveBeenCalledWith(111);
    expect(mocks.admin.power).toHaveBeenCalledWith('restart');
    expect(mocks.admin.restoreBackup.mock.invocationCallOrder[0]).toBeLessThan(mocks.admin.power.mock.invocationCallOrder[0]);
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      fields: [`backup restored: ${BACKUPS[0].name}`],
    }));
  });

  it('says when the restart was not accepted (the restore stands)', async () => {
    mocks.admin.power.mockRejectedValue(new Error('socket hang up'));
    const res = await restore('son-1', '111');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, restarted: false });
  });

  it('records a restore the app took but never answered, and says it may have gone through', async () => {
    mocks.admin.restoreBackup.mockRejectedValue(noAnswer('ECONNABORTED'));
    const res = await restore('son-1', '111');
    expect(res.status).toBe(504);
    expect((await res.json()).error).toMatch(/may have gone through/);
    expect(mocks.admin.power).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      fields: [`backup restore sent: ${BACKUPS[0].name} (no answer from the app)`],
    }));
  });

  it('records nothing when the restore never reached the app', async () => {
    mocks.admin.restoreBackup.mockRejectedValue(noAnswer('ECONNREFUSED'));
    expect((await restore('son-1', '111')).status).toBe(500);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('neither restarts nor records a restore the app refused', async () => {
    mocks.admin.restoreBackup.mockRejectedValue(new Error('Request failed with status code 500'));
    expect((await restore('son-1', '111')).status).toBe(500);
    expect(mocks.admin.power).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe('download', () => {
  it("streams the file from the app's own path, uncached, and records it", async () => {
    const res = await download('son-1', '222');
    expect(res.status).toBe(200);
    expect(mocks.admin.downloadBackup).toHaveBeenCalledWith(`/backup/manual/${BACKUPS[1].name}`);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${BACKUPS[1].name}"`);
    // The app's length isn't passed on: axios may have unzipped a proxy's gzip.
    expect(res.headers.get('content-length')).toBeNull();
    expect(await res.text()).toBe('PK zip bytes');
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      fields: [`backup downloaded: ${BACKUPS[1].name}`],
    }));
  });

  it('refuses a sign-in page in place of the zip, recording nothing', async () => {
    const stream = Readable.from([Buffer.from('<html>login</html>')]);
    mocks.admin.downloadBackup.mockResolvedValue({ stream, contentType: 'text/html; charset=utf-8' });
    const res = await download('son-1', '222');
    expect(res.status).toBe(502);
    expect(stream.destroyed).toBe(true);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('records nothing when the app fails after the password, and drains its error stream', async () => {
    const errorStream = Readable.from([Buffer.from('oops')]);
    mocks.admin.downloadBackup.mockRejectedValue(Object.assign(new Error('Request failed with status code 500'), {
      isAxiosError: true,
      response: { status: 500, data: errorStream },
    }));
    expect((await download('son-1', '222')).status).toBe(500);
    expect(errorStream.destroyed).toBe(true);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("lets the app's stream go when the audit row can't be written", async () => {
    const stream = new Readable({ read() {} });
    mocks.admin.downloadBackup.mockResolvedValue({ stream, contentType: 'application/zip' });
    mocks.audit.mockRejectedValueOnce(new Error('database unavailable'));
    expect((await download('son-1', '222')).status).toBe(500);
    expect(stream.destroyed).toBe(true);
  });

  it("stops the app's stream when the download is abandoned", async () => {
    const stream = new Readable({ read() {} });
    mocks.admin.downloadBackup.mockResolvedValue({ stream, contentType: 'application/zip' });
    const controller = new AbortController();
    const res = await downloadPost(new NextRequest('http://localhost/api/admin/arr-system/backups/222/download?instanceId=son-1', {
      method: 'POST',
      body: JSON.stringify(FACTORS),
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    }), ctx('222'));
    expect(res.status).toBe(200);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stream.destroyed).toBe(true);
  });

  it('builds the path from the checked type and name, never from the app\'s path field', async () => {
    mocks.admin.getBackups.mockResolvedValue([{ ...BACKUPS[1], path: '/api/v3/config/host' }]);
    await download('son-1', '222');
    expect(mocks.admin.downloadBackup).toHaveBeenCalledWith(`/backup/manual/${BACKUPS[1].name}`);
  });
});

describe('restore from a file', () => {
  it('restores a backup of this app from memory, then restarts it', async () => {
    const res = await upload('son-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, restarted: true });
    const [blob, name] = mocks.admin.restoreUploadedBackup.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(name).toBe('backup.zip');
    expect(mocks.admin.power).toHaveBeenCalledWith('restart');
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ fields: ['backup restored from a file'] }));
    expect(mocks.stepUp).toHaveBeenCalledWith(expect.anything(), ADMIN, expect.objectContaining(FACTORS), 'arr-backup-restore', expect.any(String));
  });

  it('needs the declared length, and refuses one over the proxy limit before reading the body', async () => {
    expect((await upload('son-1', {}, { length: null })).status).toBe(411);
    expect((await upload('son-1', {}, { length: 10 * 1024 * 1024 + 1 })).status).toBe(413);
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.stepUp).not.toHaveBeenCalled();
  });

  it('refuses a file over its own limit that is still under the proxy limit', async () => {
    const big = makeZip({ 'sonarr.db': 'x'.repeat(10 * 1024 * 1024 - 32 * 1024) });
    expect((await upload('son-1', { file: big })).status).toBe(413);
    expect(mocks.stepUp).not.toHaveBeenCalled();
  });

  it('records an upload restore the app never answered', async () => {
    mocks.admin.restoreUploadedBackup.mockRejectedValue(noAnswer('ECONNRESET'));
    expect((await upload('son-1')).status).toBe(504);
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      fields: ['backup restore from a file sent (no answer from the app)'],
    }));
  });

  it.each([
    ['no file', { file: null }, 400],
    ['an empty file', { file: new Uint8Array() }, 400],
    ['a file that is not a zip', { file: new TextEncoder().encode('hello') }, 400],
    ["another app's backup", { file: makeZip({ 'config.xml': '<Config/>', 'radarr.db': 'db' }) }, 400],
    ['the wrong word', { confirm: 'DELETE' }, 400],
  ])('refuses %s before the password', async (_label, fields, status) => {
    expect((await upload('son-1', fields)).status).toBe(status);
    expect(mocks.stepUp).not.toHaveBeenCalled();
    expect(upstreamCalls()).toBe(0);
  });

  it('stops at a refused password, sending the app nothing', async () => {
    mocks.stepUp.mockResolvedValue(NextResponse.json({ error: 'nope', needsStepUp: true, needsCode: true }, { status: 403 }));
    expect((await upload('son-1')).status).toBe(403);
    expect(upstreamCalls()).toBe(0);
  });
});

describe('zip check', () => {
  it('reads the names of the files in a zip', () => {
    expect(zipEntryNames(makeZip({ 'config.xml': 'a', 'sonarr.db': 'b', INFO: 'c' }))).toEqual(['config.xml', 'sonarr.db', 'INFO']);
  });

  it('refuses what is not a whole zip', () => {
    const zip = makeZip({ 'sonarr.db': 'b' });
    expect(zipEntryNames(zip.subarray(0, zip.length - 10))).toBeNull();
    expect(zipEntryNames(new TextEncoder().encode('PK not really a zip, just text that is long enough'))).toBeNull();
    expect(zipEntryNames(new Uint8Array())).toBeNull();
  });

  it('refuses a central directory that lies about itself', () => {
    const zip = makeZip({ 'sonarr.db': 'b' });
    const end = zip.length - 22;
    const edit = (fn: (v: DataView) => void) => {
      const copy = zip.slice();
      fn(new DataView(copy.buffer));
      return copy;
    };
    // More entries than there are.
    expect(zipEntryNames(edit((v) => v.setUint16(end + 10, 5, true)))).toBeNull();
    // The directory starts past the end record.
    expect(zipEntryNames(edit((v) => v.setUint32(end + 16, end + 4, true)))).toBeNull();
    // ZIP64 markers.
    expect(zipEntryNames(edit((v) => v.setUint16(end + 10, 0xffff, true)))).toBeNull();
    expect(zipEntryNames(edit((v) => v.setUint32(end + 16, 0xffffffff, true)))).toBeNull();
    // A name that runs past the end record.
    const central = new DataView(zip.buffer).getUint32(end + 16, true);
    expect(zipEntryNames(edit((v) => v.setUint16(central + 28, 0xfff0, true)))).toBeNull();
  });

  it("wants each app's own database at the top level", () => {
    expect(uploadedBackupProblem('SONARR', makeZip({ 'Sonarr.db': 'b' }))).toBeNull();
    expect(uploadedBackupProblem('PROWLARR', makeZip({ 'prowlarr.db': 'b', 'config.xml': 'a' }))).toBeNull();
    expect(uploadedBackupProblem('LIDARR', makeZip({ 'backup/lidarr.db': 'b' }))).toMatch(/no lidarr\.db/);
    expect(uploadedBackupProblem('RADARR', makeZip({ 'config.xml': 'a' }))).toMatch(/no radarr\.db/);
  });
});
