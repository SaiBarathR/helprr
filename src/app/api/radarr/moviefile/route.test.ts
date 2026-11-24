import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  getRadarrClient: vi.fn(),
  recordFileAudit: vi.fn(),
  radarr: { getMovieFiles: vi.fn(), bulkEditMovieFiles: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/service-helpers', () => ({ getRadarrClient: mocks.getRadarrClient }));
vi.mock('@/lib/file-audit', () => ({ recordFileAudit: mocks.recordFileAudit }));
vi.mock('@/lib/cache/tagged-library', () => ({ invalidateTaggedLibrary: vi.fn() }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { PUT } from './route';

const put = (edits: unknown[]) => PUT(new NextRequest('http://localhost/api/radarr/moviefile?instanceId=rad-1', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ movieId: 5, mediaTitle: 'Alien', edits }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: { id: 'u1' }, session: {} });
  mocks.getRadarrClient.mockResolvedValue(mocks.radarr);
  mocks.radarr.getMovieFiles.mockResolvedValue([{ id: 31, movieId: 5 }]);
  mocks.radarr.bulkEditMovieFiles.mockResolvedValue([]);
});

describe('PUT /api/radarr/moviefile: edition', () => {
  it('needs movies.manageFiles', async () => {
    mocks.requireUserCapability.mockResolvedValueOnce({
      ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });
    expect((await put([{ id: 31, edition: 'IMAX' }])).status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('movies.manageFiles');
    expect(mocks.radarr.bulkEditMovieFiles).not.toHaveBeenCalled();
  });

  it('sends a trimmed edition, and an empty one to clear it', async () => {
    expect((await put([{ id: 31, edition: "  Director's Cut " }])).status).toBe(200);
    expect(mocks.radarr.bulkEditMovieFiles).toHaveBeenLastCalledWith([{ id: 31, edition: "Director's Cut" }]);
    expect((await put([{ id: 31, edition: '' }])).status).toBe(200);
    expect(mocks.radarr.bulkEditMovieFiles).toHaveBeenLastCalledWith([{ id: 31, edition: '' }]);
    expect(mocks.recordFileAudit).toHaveBeenLastCalledWith(expect.objectContaining({
      operation: 'EDIT', details: { movieFileIds: [31], fields: ['edition'] },
    }));
  });

  it.each([
    ['a number', 7],
    ['an object', { name: 'IMAX' }],
    ['over 100 characters', 'x'.repeat(101)],
  ])('rejects %s', async (_label, edition) => {
    expect((await put([{ id: 31, edition }])).status).toBe(400);
    expect(mocks.radarr.bulkEditMovieFiles).not.toHaveBeenCalled();
  });
});
