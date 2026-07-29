import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  can: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/permissions', () => ({ can: mocks.can }));
vi.mock('@/lib/db', () => ({
  prisma: { serviceConnection: { findMany: mocks.findMany } },
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));

import { GET } from '@/app/api/services/external-urls/route';

const user = {
  id: 'member-1',
  role: 'member',
  template: 'member',
  permissions: {},
};

const connections = [
  { id: 'sonarr-1', type: 'SONARR', externalUrl: 'https://sonarr.example' },
  { id: 'radarr-1', type: 'RADARR', externalUrl: 'https://radarr.example' },
  { id: 'jellyfin-1', type: 'JELLYFIN', externalUrl: 'https://jellyfin.example' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ ok: true, user, session: {} });
  mocks.findMany.mockResolvedValue(connections);
  mocks.can.mockImplementation((_user: unknown, capability: string) =>
    capability === 'series.view' || capability === 'jellyfin.view'
  );
});

describe('external service URL filtering', () => {
  it('rejects unauthenticated requests before reading connection URLs', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('returns only connections covered by the current user capabilities', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      connections[0],
      connections[2],
    ]);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
  });

  it('allows settings.instances as an administrative override', async () => {
    mocks.can.mockImplementation((_user: unknown, capability: string) =>
      capability === 'settings.instances'
    );

    const response = await GET();

    await expect(response.json()).resolves.toEqual(connections);
  });

  it('fails closed for a member with every relevant capability revoked', async () => {
    mocks.can.mockReturnValue(false);

    const response = await GET();

    await expect(response.json()).resolves.toEqual([]);
  });
});
