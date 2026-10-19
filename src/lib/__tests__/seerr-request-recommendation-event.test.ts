import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  user: null as unknown,
  createRequest: vi.fn(),
  pendingCreate: vi.fn(),
  recordRequestEvent: vi.fn(),
  warn: vi.fn(),
  tmdb: { movieDetails: vi.fn(), tvDetails: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: async () => ({ ok: true, user: mocks.user }) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/logger', () => ({ logger: { warn: mocks.warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/notification-service', () => ({ notifyEvent: vi.fn(async () => 0) }));
vi.mock('@/lib/service-helpers', () => ({
  getSeerrClient: async () => ({ createRequest: mocks.createRequest }),
  getTMDBClient: async () => mocks.tmdb,
}));
vi.mock('@/lib/recommendations/events', () => ({ recordRequestEvent: mocks.recordRequestEvent }));
vi.mock('@/lib/db', () => ({
  prisma: {
    pendingRequest: { create: mocks.pendingCreate },
    user: { findMany: vi.fn(async () => [{ id: 'admin-1' }]) },
  },
}));

import { POST } from '@/app/api/seerr/requests/route';

const admin = { id: 'admin-1', role: 'admin', template: 'admin', permissions: {}, seerrUserId: '1', displayName: 'Admin' };
const member = { id: 'member-1', role: 'member', template: 'member', permissions: {}, seerrUserId: '7', displayName: 'Member' };

const request = (body: Record<string, unknown>) => POST(new NextRequest('http://localhost/api/seerr/requests', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mediaType: 'movie', tmdbId: 603, ...body }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createRequest.mockResolvedValue({ id: 50 });
  mocks.pendingCreate.mockResolvedValue({ id: 'pending-1' });
  mocks.recordRequestEvent.mockResolvedValue({ ok: true, stored: 1 });
  mocks.tmdb.movieDetails.mockResolvedValue({ genres: [{ id: 878, name: 'Science Fiction' }, { id: 28, name: 'Action' }] });
  mocks.tmdb.tvDetails.mockResolvedValue({ genres: [{ id: 18, name: 'Drama' }] });
});

describe('a Seerr request as a recommendations signal', () => {
  it('records a request sent straight to Seerr, for the person who made it', async () => {
    mocks.user = admin;
    expect((await request({ mediaType: 'tv', tmdbId: 1399 })).status).toBe(200);
    expect(mocks.createRequest).toHaveBeenCalled();
    expect(mocks.recordRequestEvent).toHaveBeenCalledWith('admin-1', 'tv', 1399, ['Drama']);
  });

  it("records a member's request parked for approval", async () => {
    mocks.user = member;
    expect(await (await request({})).json()).toEqual({ pending: true, id: 'pending-1' });
    expect(mocks.recordRequestEvent).toHaveBeenCalledWith('member-1', 'movie', 603, ['Science Fiction', 'Action']);
  });

  it('records a request an admin makes as themselves, linked or not, and a member whose Seerr id is stored loosely', async () => {
    mocks.user = admin;
    await request({ requestAs: 1 });
    mocks.user = { ...admin, seerrUserId: null };
    await request({});
    mocks.user = { ...member, seerrUserId: '07' };
    await request({});
    expect(mocks.recordRequestEvent.mock.calls.map((call) => call[0])).toEqual(['admin-1', 'admin-1', 'member-1']);
  });

  it('still records the request when TMDB cannot give its genres', async () => {
    mocks.user = admin;
    mocks.tmdb.movieDetails.mockRejectedValue(new Error('TMDB not configured'));
    expect((await request({})).status).toBe(200);
    expect(mocks.recordRequestEvent).toHaveBeenCalledWith('admin-1', 'movie', 603, undefined);
  });

  it('records nothing for a request an admin makes as someone else', async () => {
    mocks.user = admin;
    expect((await request({ requestAs: 7 })).status).toBe(200);
    expect(mocks.createRequest).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }));
    expect(mocks.recordRequestEvent).not.toHaveBeenCalled();
  });

  it('records nothing for a user without recommendations, or a request Seerr refused', async () => {
    mocks.user = { ...member, permissions: { 'recommendations.view': false } };
    await request({});
    mocks.user = admin;
    const { AxiosError } = await import('axios');
    mocks.createRequest.mockRejectedValue(new AxiosError('conflict', '409', undefined, undefined, { status: 409, data: { message: 'Already requested' } } as never));
    expect((await request({})).status).toBe(409);
    expect(mocks.recordRequestEvent).not.toHaveBeenCalled();
  });

  it('does not hold the request for a slow TMDB: past two seconds it is recorded without genres', async () => {
    vi.useFakeTimers();
    try {
      mocks.user = admin;
      mocks.tmdb.movieDetails.mockImplementation(() => new Promise(() => {}));
      const responding = request({});
      await vi.advanceTimersByTimeAsync(1_999);
      expect(mocks.recordRequestEvent).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect((await responding).status).toBe(200);
      expect(mocks.recordRequestEvent).toHaveBeenCalledWith('admin-1', 'movie', 603, undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never fails the request when the signal cannot be stored', async () => {
    mocks.user = admin;
    mocks.recordRequestEvent.mockRejectedValue(new Error('db down'));
    expect((await request({})).status).toBe(200);
    expect(mocks.warn).toHaveBeenCalledWith('Request not recorded for recommendations', expect.anything(), expect.anything());
  });
});
