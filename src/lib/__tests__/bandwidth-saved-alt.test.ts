import { beforeEach, describe, expect, it, vi } from 'vitest';

const hash = vi.hoisted(() => new Map<string, string>());
vi.mock('@/lib/redis', () => ({
  getRedisClient: vi.fn(async () => ({
    hGetAll: async () => Object.fromEntries(hash),
    hSet: async (_key: string, field: string, value: string) => { hash.set(field, value); },
    hDel: async (_key: string, field: string) => { hash.delete(field); },
  })),
}));

import { forgetAltLimits, loadSavedAltLimits, saveAltLimits } from '@/lib/bandwidth-scheduler/saved-alt';

beforeEach(() => hash.clear());

describe('the saved alternative limits', () => {
  it('round-trips each instance, and forgets one', async () => {
    await saveAltLimits('q1', { savedAlt: { alt_dl_limit: 204_800, alt_up_limit: 0 }, wroteGlobal: true });
    await saveAltLimits('q2', { savedAlt: { alt_dl_limit: 1024, alt_up_limit: 512 }, wroteGlobal: false });
    expect(await loadSavedAltLimits()).toEqual(new Map([
      ['q1', { savedAlt: { alt_dl_limit: 204_800, alt_up_limit: 0 }, wroteGlobal: true }],
      ['q2', { savedAlt: { alt_dl_limit: 1024, alt_up_limit: 512 }, wroteGlobal: false }],
    ]));
    await forgetAltLimits('q1');
    expect([...(await loadSavedAltLimits()).keys()]).toEqual(['q2']);
  });

  it('drops a field it cannot read rather than restoring nonsense', async () => {
    hash.set('bad', 'not json');
    hash.set('partial', JSON.stringify({ alt_dl_limit: 1 }));
    hash.set('old', JSON.stringify({ alt_dl_limit: 1, alt_up_limit: 2 }));
    expect(await loadSavedAltLimits()).toEqual(new Map([
      ['old', { savedAlt: { alt_dl_limit: 1, alt_up_limit: 2 }, wroteGlobal: false }],
    ]));
  });
});
