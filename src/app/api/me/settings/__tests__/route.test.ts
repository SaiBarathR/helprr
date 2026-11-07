import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({ prisma: { userSettings: { findUnique: mocks.findUnique, upsert: mocks.upsert } } }));

import { GET, PATCH } from '@/app/api/me/settings/route';

const STORED = { quietHoursEnabled: false, quietHoursStart: null, quietHoursEnd: null, timeFormat: null, dateFormat: null, watchingEpisodeDays: 14 };

function patch(body: unknown) {
  return PATCH(new NextRequest('http://localhost/api/me/settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  }));
}

describe('/api/me/settings date and time format', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'user-1' }, session: {} });
  });

  it('reports auto for a user with nothing stored', async () => {
    mocks.findUnique.mockResolvedValue(null);
    const res = await GET();
    expect(await res.json()).toEqual({
      quietHoursEnabled: false,
      quietHoursStart: null,
      quietHoursEnd: null,
      timeFormat: 'auto',
      dateFormat: 'auto',
      watchingEpisodeDays: 14,
      jellyfinLinked: false,
    });
  });

  it('saves a format for the signed-in user only, storing auto as null', async () => {
    mocks.upsert.mockResolvedValue({ ...STORED, timeFormat: '24h' });
    const res = await patch({ timeFormat: '24h', dateFormat: 'auto' });
    expect(res.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1' },
      update: { timeFormat: '24h', dateFormat: null },
      create: { userId: 'user-1', timeFormat: '24h', dateFormat: null },
    }));
    expect(await res.json()).toMatchObject({ timeFormat: '24h', dateFormat: 'auto' });
  });

  it('rejects unknown formats without writing', async () => {
    expect((await patch({ timeFormat: 'h23' })).status).toBe(400);
    expect((await patch({ dateFormat: 'ymd' })).status).toBe(400);
    expect((await patch({ dateFormat: null })).status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('saves the New episode window and says whether Jellyfin is linked', async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'user-1', jellyfinUserId: 'jf-1' }, session: {} });
    mocks.upsert.mockResolvedValue({ ...STORED, watchingEpisodeDays: 0 });
    const res = await patch({ watchingEpisodeDays: 0 });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1' },
      update: { watchingEpisodeDays: 0 },
    }));
    expect(await res.json()).toMatchObject({ watchingEpisodeDays: 0, jellyfinLinked: true });
  });

  it('rejects a window that is not offered', async () => {
    for (const watchingEpisodeDays of [5, -1, 14.5, '14', null]) {
      expect((await patch({ watchingEpisodeDays })).status).toBe(400);
    }
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('requires a session', async () => {
    mocks.requireUser.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await patch({ timeFormat: '24h' })).status).toBe(401);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
