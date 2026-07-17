import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireCapability: vi.fn(),
  historyCount: vi.fn(),
  historyGroupBy: vi.fn(),
  strikeCount: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: mocks.requireAuth,
  requireCapability: mocks.requireCapability,
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));
vi.mock('@/lib/db', () => ({ prisma: {
  cleanupHistory: { count: mocks.historyCount, groupBy: mocks.historyGroupBy },
  cleanupStrike: { count: mocks.strikeCount },
} }));

import { GET } from '@/app/api/cleanup/stats/route';

describe('cleanup stats route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(null);
    mocks.requireCapability.mockResolvedValue(null);
    mocks.historyCount.mockResolvedValue(0);
    mocks.historyGroupBy.mockResolvedValue([]);
    mocks.strikeCount.mockResolvedValue(0);
  });

  it('counts removed tiles only from successful or legacy removal outcomes', async () => {
    const response = await GET(new NextRequest('http://localhost/api/cleanup/stats'));
    expect(response.status).toBe(200);

    const removedActions = ['removedFromClient', 'removedFromQueue', 'categoryChanged'];
    const removalCountCalls = mocks.historyCount.mock.calls
      .map(([arg]) => arg)
      .filter((arg) => arg.where.action?.in);
    expect(removalCountCalls).toHaveLength(3);
    for (const call of removalCountCalls) {
      expect(call.where).toMatchObject({
        action: { in: removedActions },
        OR: [{ outcomeStatus: null }, { outcomeStatus: 'succeeded' }],
      });
    }
    expect(mocks.historyCount).toHaveBeenCalledWith({ where: { action: 'strikeAdded' } });
    expect(mocks.historyCount).toHaveBeenCalledWith({ where: { reSearched: true } });
    expect(mocks.historyGroupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        action: { in: removedActions },
        OR: [{ outcomeStatus: null }, { outcomeStatus: 'succeeded' }],
      }),
    }));
  });
});
