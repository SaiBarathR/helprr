import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  user: null as Partial<User> | null,
  service: {
    previewLibraryCandidates: vi.fn(),
    markLeavingSoon: vi.fn(),
    previewLibraryDeletion: vi.fn(),
    executeLibraryDeletion: vi.fn(),
    listLeavingSoon: vi.fn(),
    keepLeavingSoonItem: vi.fn(),
    processingMediaType: vi.fn(),
  },
  save: vi.fn(),
  consume: vi.fn(),
  issue: vi.fn(),
  findItem: vi.fn(),
}));

// Auth mirrors the real helpers' policy over a test user, using the real can().
vi.mock('@/lib/auth', async () => {
  const { can } = await import('@/lib/permissions');
  const unauthorized = () => ({ ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
  const forbidden = () => ({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
  return {
    requireUser: async () => (mocks.user ? { ok: true, user: mocks.user } : unauthorized()),
    requireAdmin: async () => (!mocks.user ? unauthorized() : mocks.user.role === 'admin' ? { ok: true, user: mocks.user } : forbidden()),
    requireUserAnyCapability: async (caps: string[]) => (!mocks.user ? unauthorized()
      : caps.some((cap) => can(mocks.user as User, cap as never)) ? { ok: true, user: mocks.user } : forbidden()),
  };
});
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/library-cleanup/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/library-cleanup/service')>()),
  ...mocks.service,
  withLibraryDeletionLock: (run: () => Promise<unknown>) => run(),
}));
vi.mock('@/lib/library-cleanup/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/library-cleanup/config')>()),
  loadLibraryCleanupSettings: vi.fn(async () => (await importOriginal<typeof import('@/lib/library-cleanup/config')>()).DEFAULT_LIBRARY_CLEANUP_SETTINGS),
  saveLibraryCleanupSettings: mocks.save,
}));
vi.mock('@/lib/cleanup/preview-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cleanup/preview-store')>()),
  consumeCleanupPreview: mocks.consume,
  issueCleanupPreview: mocks.issue,
}));
vi.mock('@/lib/db', () => ({ prisma: { leavingSoonItem: { findUnique: mocks.findItem } } }));
vi.mock('@/lib/api-error', () => ({
  upstreamErrorResponse: (_e: unknown, fallback: string) => NextResponse.json({ error: fallback }, { status: 502 }),
}));

import * as config from '../config/route';
import * as preview from '../preview/route';
import * as mark from '../leaving-soon/route';
import * as deletePreview from '../delete/preview/route';
import * as deleteRun from '../delete/run/route';
import * as shelf from '../../../leaving-soon/route';
import * as keep from '../../../leaving-soon/[id]/keep/route';
import { DEFAULT_LIBRARY_CLEANUP_SETTINGS } from '@/lib/library-cleanup/config';
import { InvalidCleanupPreviewError } from '@/lib/cleanup/preview-store';
import { LibraryCleanupUnavailableError } from '@/lib/library-cleanup/inputs';

const admin = { id: 'admin-1', username: 'admin', role: 'admin', template: 'admin', permissions: {}, status: 'active' } as Partial<User>;
const member = (permissions: Record<string, boolean> = {}) =>
  ({ id: 'member-1', username: 'mia', role: 'member', template: 'member', permissions, status: 'active' }) as Partial<User>;

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  });
}
const keepCtx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = admin;
});

describe('library cleanup admin routes', () => {
  const calls: Array<[string, () => Promise<Response>]> = [
    ['GET config', () => config.GET()],
    ['PUT config', () => config.PUT(req('/x', 'PUT', DEFAULT_LIBRARY_CLEANUP_SETTINGS))],
    ['POST preview', () => preview.POST(req('/x', 'POST', { mediaType: 'movie' }))],
    ['POST leaving-soon', () => mark.POST(req('/x', 'POST', { mediaType: 'movie', keys: ['RADARR:r1:1'] }))],
    ['POST delete/preview', () => deletePreview.POST(req('/x', 'POST', { addImportListExclusion: false }))],
    ['POST delete/run', () => deleteRun.POST(req('/x', 'POST', { previewToken: 'x'.repeat(43) }))],
  ];

  it.each(calls)('%s is admin-only, even for a member granted every cleanup capability', async (_name, call) => {
    mocks.user = member({ 'cleanup.view': true, 'cleanup.manage': true, 'movies.delete': true, 'series.delete': true });
    expect((await call()).status).toBe(403);
    mocks.user = null;
    expect((await call()).status).toBe(401);
    for (const fn of Object.values(mocks.service)) expect(fn).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it('validates the settings before saving', async () => {
    expect((await config.PUT(req('/x', 'PUT', { ...DEFAULT_LIBRARY_CLEANUP_SETTINGS, keepTag: 'bad tag' }))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
    expect((await config.PUT(req('/x', 'PUT', DEFAULT_LIBRARY_CLEANUP_SETTINGS))).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(DEFAULT_LIBRARY_CLEANUP_SETTINGS);
  });

  it('rejects malformed mark requests', async () => {
    expect((await mark.POST(req('/x', 'POST', { mediaType: 'music', keys: ['RADARR:r1:1'] }))).status).toBe(400);
    expect((await mark.POST(req('/x', 'POST', { mediaType: 'movie', keys: [] }))).status).toBe(400);
    expect((await mark.POST(req('/x', 'POST', { mediaType: 'movie', keys: ['LIDARR:x:1'] }))).status).toBe(400);
    expect(mocks.service.markLeavingSoon).not.toHaveBeenCalled();
  });

  it('answers 503 and changes nothing when a source is unreadable', async () => {
    mocks.service.previewLibraryCandidates.mockRejectedValue(new LibraryCleanupUnavailableError('Jellyfin could not be read. Nothing was changed.'));
    const res = await preview.POST(req('/x', 'POST', { mediaType: 'movie' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
  });

  it('issues a token only when something can be acted on', async () => {
    mocks.service.previewLibraryDeletion.mockResolvedValue({ items: [{ status: 'protected' }], binding: {}, warnings: [], readyCount: 0 });
    const body = await (await deletePreview.POST(req('/x', 'POST', { addImportListExclusion: false }))).json();
    expect(body.previewToken).toBeUndefined();
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it('needs a valid, unspent token to delete', async () => {
    expect((await deleteRun.POST(req('/x', 'POST', {}))).status).toBe(428);
    mocks.consume.mockRejectedValue(new InvalidCleanupPreviewError());
    const res = await deleteRun.POST(req('/x', 'POST', { previewToken: 'x'.repeat(43) }));
    expect(res.status).toBe(409);
    expect(mocks.service.executeLibraryDeletion).not.toHaveBeenCalled();
    expect(mocks.consume).toHaveBeenCalledWith('admin-1', 'library', 'x'.repeat(43));
  });
});

describe('Leaving soon shelf and Keep', () => {
  it('lists only the library types the member may view, without admin detail', async () => {
    mocks.service.listLeavingSoon.mockResolvedValue([]);
    mocks.user = member({ 'series.view': false });
    await shelf.GET(req('/api/leaving-soon'));
    expect(mocks.service.listLeavingSoon).toHaveBeenLastCalledWith(['movie'], false);
    await shelf.GET(req('/api/leaving-soon?type=series'));
    expect(mocks.service.listLeavingSoon).toHaveBeenLastCalledWith([], false);
    mocks.user = admin;
    await shelf.GET(req('/api/leaving-soon?type=series'));
    expect(mocks.service.listLeavingSoon).toHaveBeenLastCalledWith(['series'], true);
    expect((await shelf.GET(req('/api/leaving-soon?type=music'))).status).toBe(400);
    mocks.user = member({ 'movies.view': false, 'series.view': false });
    expect((await shelf.GET(req('/api/leaving-soon'))).status).toBe(403);
  });

  it('lets a member keep a title they can view, and audits through the service', async () => {
    mocks.user = member();
    mocks.findItem.mockResolvedValue({ id: 'ls1', mediaType: 'series' });
    const res = await keep.POST(req('/x', 'POST'), keepCtx('ls1'));
    expect(res.status).toBe(200);
    expect(mocks.service.keepLeavingSoonItem).toHaveBeenCalledWith({ id: 'ls1', mediaType: 'series' }, { id: 'member-1', username: 'mia' });
  });

  it.each<[string, Partial<User> | null, unknown, number]>([
    ['no view access', member({ 'series.view': false }), { id: 'ls1', mediaType: 'series' }, 404],
    ['unknown library type', member(), { id: 'ls1', mediaType: 'music' }, 404],
    ['missing item', member(), null, 404],
    ['signed out', null, { id: 'ls1', mediaType: 'movie' }, 401],
  ])('refuses Keep: %s', async (_name, user, item, status) => {
    mocks.user = user;
    mocks.findItem.mockResolvedValue(item);
    expect((await keep.POST(req('/x', 'POST'), keepCtx('ls1'))).status).toBe(status);
    expect(mocks.service.keepLeavingSoonItem).not.toHaveBeenCalled();
  });

  it('answers 409 while Delete now holds the title', async () => {
    mocks.user = member();
    mocks.findItem.mockResolvedValue({ id: 'ls1', mediaType: 'movie' });
    const { LeavingSoonClaimedError } = await import('@/lib/library-cleanup/service');
    mocks.service.keepLeavingSoonItem.mockRejectedValue(new LeavingSoonClaimedError());
    expect((await keep.POST(req('/x', 'POST'), keepCtx('ls1'))).status).toBe(409);
  });

  it('says "being processed" (409) while Delete now holds a title the caller may view, and 404 otherwise', async () => {
    mocks.findItem.mockResolvedValue(null);
    mocks.service.processingMediaType.mockReturnValue('series');
    mocks.user = member();
    const res = await keep.POST(req('/x', 'POST'), keepCtx('ls1'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Being processed, try again in a moment.' });
    mocks.user = member({ 'series.view': false });
    expect((await keep.POST(req('/x', 'POST'), keepCtx('ls1'))).status).toBe(404);
    expect(mocks.service.keepLeavingSoonItem).not.toHaveBeenCalled();
  });

  it('reports an arr failure and leaves the title listed', async () => {
    mocks.user = member();
    mocks.findItem.mockResolvedValue({ id: 'ls1', mediaType: 'movie' });
    mocks.service.keepLeavingSoonItem.mockRejectedValue(new Error('Radarr down'));
    expect((await keep.POST(req('/x', 'POST'), keepCtx('ls1'))).status).toBe(502);
  });
});
