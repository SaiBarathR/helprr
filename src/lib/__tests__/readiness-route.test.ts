import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assessReadiness: vi.fn(),
}));

vi.mock('@/lib/readiness', () => ({
  assessReadiness: mocks.assessReadiness,
}));

import { GET } from '@/app/api/ready/route';

describe('readiness route', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an uncached 200 for a ready application', async () => {
    mocks.assessReadiness.mockResolvedValue({
      status: 'ready',
      checks: { database: 'ok', redis: 'ok', migrations: 'ok' },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      status: 'ready',
      checks: { database: 'ok', redis: 'ok', migrations: 'ok' },
    });
  });

  it('returns an uncached 503 with component status only when not ready', async () => {
    mocks.assessReadiness.mockResolvedValue({
      status: 'not_ready',
      checks: { database: 'error', redis: 'ok', migrations: 'error' },
    });

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(JSON.parse(body)).toEqual({
      status: 'not_ready',
      checks: { database: 'error', redis: 'ok', migrations: 'error' },
    });
    expect(body).not.toContain('password');
    expect(body).not.toContain('migration_name');
  });
});
