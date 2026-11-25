import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * QBT-29: Helprr can have several qBittorrents, and a hash, category, tag or
 * setting is one of them. Every qBittorrent route takes `?instanceId=`: one
 * that is not a qBittorrent connection is refused before anything reaches
 * qBittorrent (never swapped for the default), a known one is used as named,
 * and none is the default instance as before.
 */
const mocks = vi.hoisted(() => ({
  instances: [{ id: 'q1', type: 'QBITTORRENT' }, { id: 'q2', type: 'QBITTORRENT' }],
  getQBittorrentClient: vi.fn(),
  // A signed-in user without the capability (or admin role) the handler needs.
  denied: false,
}));

const admin = { id: 'u1', role: 'admin', username: 'admin', capabilities: [] };
vi.mock('@/lib/auth', async () => {
  const { NextResponse } = await import('next/server');
  const ok = async () => ({ ok: true, user: admin, session: { id: 's1' } });
  const gated = async () => (mocks.denied
    ? { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    : ok());
  return { requireUser: vi.fn(ok), requireUserCapability: vi.fn(gated), requireAdmin: vi.fn(gated), requireAuth: vi.fn(async () => null) };
});
vi.mock('@/lib/permissions', () => ({ can: () => !mocks.denied }));
const listConnections = vi.hoisted(() => vi.fn(async (type: string) => (type === 'QBITTORRENT' ? mocks.instances : [])));
vi.mock('@/lib/arr-instances', () => ({ listConnections }));
vi.mock('@/lib/service-helpers', () => ({
  getQBittorrentClient: mocks.getQBittorrentClient,
  getQBittorrentClients: vi.fn(async () => []),
}));
vi.mock('@/lib/cache/qbittorrent-version', () => ({ bumpQbitCacheVersion: vi.fn(), getQbitCacheVersion: vi.fn(async () => 0) }));
vi.mock('@/lib/security-audit', () => ({ recordSettingsUpdated: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import * as list from '@/app/api/qbittorrent/route';
import * as summary from '@/app/api/qbittorrent/summary/route';
import * as torrent from '@/app/api/qbittorrent/[hash]/route';
import * as details from '@/app/api/qbittorrent/[hash]/details/route';
import * as files from '@/app/api/qbittorrent/[hash]/files/route';
import * as priority from '@/app/api/qbittorrent/[hash]/files/priority/route';
import * as rename from '@/app/api/qbittorrent/[hash]/files/rename/route';
import * as peers from '@/app/api/qbittorrent/[hash]/peers/route';
import * as ban from '@/app/api/qbittorrent/[hash]/peers/ban/route';
import * as trackers from '@/app/api/qbittorrent/[hash]/trackers/route';
import * as categories from '@/app/api/qbittorrent/categories/route';
import * as tags from '@/app/api/qbittorrent/tags/route';
import * as folders from '@/app/api/qbittorrent/folders/route';
import * as transfer from '@/app/api/qbittorrent/transfer/route';
import * as limits from '@/app/api/qbittorrent/transfer/limits/route';
import * as stats from '@/app/api/qbittorrent/transfer/stats/route';
import * as options from '@/app/api/qbittorrent/options/route';
import * as queueSeeding from '@/app/api/qbittorrent/queue-seeding/route';
import * as log from '@/app/api/qbittorrent/log/route';

type Handler = (request: NextRequest, context: { params: Promise<{ hash: string }> }) => Promise<Response>;
const HASH = 'a'.repeat(40);

// Every handler, with a request it would act on (so a known instance gets as far as its client).
const ROUTES: Array<[string, Handler, string, string, unknown?]> = [
  ['GET /api/qbittorrent', list.GET as Handler, 'GET', '/api/qbittorrent'],
  ['POST /api/qbittorrent (action)', list.POST as Handler, 'POST', '/api/qbittorrent', { action: 'pause', hash: HASH }],
  ['GET summary', summary.GET as Handler, 'GET', '/api/qbittorrent/summary?view=delta'],
  ['POST [hash]', torrent.POST as Handler, 'POST', `/api/qbittorrent/${HASH}`, { action: 'stop' }],
  ['GET [hash]/details', details.GET as Handler, 'GET', `/api/qbittorrent/${HASH}/details`],
  ['GET [hash]/files', files.GET as Handler, 'GET', `/api/qbittorrent/${HASH}/files`],
  ['POST [hash]/files/priority', priority.POST as Handler, 'POST', `/api/qbittorrent/${HASH}/files/priority`, { ids: [0], priority: 0 }],
  ['POST [hash]/files/rename', rename.POST as Handler, 'POST', `/api/qbittorrent/${HASH}/files/rename`, { kind: 'file', path: 'a.mkv', name: 'b.mkv' }],
  ['GET [hash]/peers', peers.GET as Handler, 'GET', `/api/qbittorrent/${HASH}/peers`],
  ['POST [hash]/peers', peers.POST as Handler, 'POST', `/api/qbittorrent/${HASH}/peers`, { peers: ['10.0.0.1:6881'] }],
  ['POST [hash]/peers/ban', ban.POST as Handler, 'POST', `/api/qbittorrent/${HASH}/peers/ban`, { key: 'A'.repeat(22) }],
  ['POST [hash]/trackers', trackers.POST as Handler, 'POST', `/api/qbittorrent/${HASH}/trackers`, { action: 'add', urls: ['udp://tracker.example:80/announce'] }],
  ['GET categories', categories.GET as Handler, 'GET', '/api/qbittorrent/categories'],
  ['POST categories', categories.POST as Handler, 'POST', '/api/qbittorrent/categories', { name: 'tv', savePath: '' }],
  ['PATCH categories', categories.PATCH as Handler, 'PATCH', '/api/qbittorrent/categories', { name: 'tv', savePath: '' }],
  ['DELETE categories', categories.DELETE as Handler, 'DELETE', '/api/qbittorrent/categories', { categories: ['tv'] }],
  ['GET tags', tags.GET as Handler, 'GET', '/api/qbittorrent/tags'],
  ['POST tags', tags.POST as Handler, 'POST', '/api/qbittorrent/tags', { name: 'keep' }],
  ['DELETE tags', tags.DELETE as Handler, 'DELETE', '/api/qbittorrent/tags', { tags: ['keep'] }],
  ['GET folders', folders.GET as Handler, 'GET', '/api/qbittorrent/folders?for=add'],
  ['GET transfer', transfer.GET as Handler, 'GET', '/api/qbittorrent/transfer'],
  ['GET transfer/limits', limits.GET as Handler, 'GET', '/api/qbittorrent/transfer/limits'],
  ['POST transfer/limits', limits.POST as Handler, 'POST', '/api/qbittorrent/transfer/limits', { action: 'toggleSpeedLimitsMode' }],
  ['GET transfer/stats', stats.GET as Handler, 'GET', '/api/qbittorrent/transfer/stats'],
  ['GET options', options.GET as Handler, 'GET', '/api/qbittorrent/options'],
  ['GET queue-seeding', queueSeeding.GET as Handler, 'GET', '/api/qbittorrent/queue-seeding'],
  ['PATCH queue-seeding', queueSeeding.PATCH as Handler, 'PATCH', '/api/qbittorrent/queue-seeding', { max_active_downloads: 3 }],
  ['GET log', log.GET as Handler, 'GET', '/api/qbittorrent/log'],
];

function call(handler: Handler, method: string, path: string, body: unknown, instance: string | null) {
  const url = new URL(`http://localhost${path}`);
  if (instance !== null) url.searchParams.set('instanceId', instance);
  const request = new NextRequest(url, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
  return handler(request, { params: Promise.resolve({ hash: HASH }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.denied = false;
  // Reaching the client is what is checked: what qBittorrent would answer is not.
  mocks.getQBittorrentClient.mockRejectedValue(new Error('stop here'));
});

describe('qBittorrent routes and instanceId (QBT-29)', () => {
  it('covers every qBittorrent route handler', () => {
    // Read from the route files, so a new handler must be added here (and checked).
    const root = path.join(process.cwd(), 'src/app/api/qbittorrent');
    const handlers = (readdirSync(root, { recursive: true }) as string[])
      .filter((file) => file.endsWith('route.ts'))
      // The schedule names no qBittorrent (it applies to all); instances is the list itself.
      .filter((file) => !file.startsWith('bandwidth-schedule') && !file.startsWith('instances'))
      .flatMap((file) => [...readFileSync(path.join(root, file), 'utf8').matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)]);
    expect(ROUTES).toHaveLength(handlers.length);
  });

  it.each(ROUTES)('%s refuses an id that is not a qBittorrent, before asking qBittorrent anything', async (_name, handler, method, path, body) => {
    for (const bad of ['sonarr-1', '', 'x'.repeat(129)]) {
      const res = await call(handler, method, path, body, bad);
      expect(res.status, bad).toBe(400);
    }
    expect(mocks.getQBittorrentClient).not.toHaveBeenCalled();
  });

  it.each(ROUTES)('%s uses the named qBittorrent', async (_name, handler, method, path, body) => {
    await call(handler, method, path, body, 'q2');
    expect(mocks.getQBittorrentClient).toHaveBeenCalled();
    for (const [instanceId] of mocks.getQBittorrentClient.mock.calls) expect(instanceId).toBe('q2');
  });

  it.each(ROUTES)('%s uses the default qBittorrent when none is named', async (_name, handler, method, path, body) => {
    await call(handler, method, path, body, null);
    expect(mocks.getQBittorrentClient).toHaveBeenCalled();
    for (const [instanceId] of mocks.getQBittorrentClient.mock.calls) expect(instanceId).toBeUndefined();
  });

  // Permission first: someone who may not use a handler learns nothing about
  // which qBittorrents exist (403 for a bad id as for a real one).
  it.each([
    ...ROUTES,
    ['POST /api/qbittorrent (add)', list.POST as Handler, 'POST', '/api/qbittorrent', { urls: `magnet:?xt=urn:btih:${HASH}` }] as const,
  ])('%s refuses an unauthorised user with 403 before checking the instance', async (_name, handler, method, path, body) => {
    mocks.denied = true;
    for (const id of ['sonarr-1', 'q2']) {
      const res = await call(handler, method, path, body, id);
      expect(res.status, id).toBe(403);
    }
    expect(listConnections).not.toHaveBeenCalled();
    expect(mocks.getQBittorrentClient).not.toHaveBeenCalled();
  });
  it('POST /api/qbittorrent (file add) refuses an unauthorised user with 403 before checking the instance', async () => {
    mocks.denied = true;
    for (const id of ['sonarr-1', 'q2']) {
      const form = new FormData();
      form.append('file', new File([new Uint8Array([100, 101])], 'a.torrent'));
      const res = await list.POST(new NextRequest(`http://localhost/api/qbittorrent?instanceId=${id}`, { method: 'POST', body: form }));
      expect(res.status, id).toBe(403);
    }
    expect(listConnections).not.toHaveBeenCalled();
    expect(mocks.getQBittorrentClient).not.toHaveBeenCalled();
  });
});
