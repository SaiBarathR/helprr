import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    serviceConnection: {
      findMany: mocks.findMany,
    },
  },
}));

import { getAppShellServiceFlags } from '@/lib/app-shell-services';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAppShellServiceFlags', () => {
  it('derives all app-shell flags from one distinct service query', async () => {
    mocks.findMany.mockResolvedValue([
      { type: 'SEERR' },
      { type: 'JELLYFIN' },
    ]);

    await expect(getAppShellServiceFlags()).resolves.toEqual({
      seerrConfigured: true,
      tmdbConfigured: false,
      jellyfinConfigured: true,
    });
    expect(mocks.findMany).toHaveBeenCalledOnce();
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { type: { in: ['SEERR', 'TMDB', 'JELLYFIN'] } },
      distinct: ['type'],
      select: { type: true },
    });
  });
});
