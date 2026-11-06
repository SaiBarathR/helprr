import { describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/query-client', () => ({ handleAuthError: vi.fn() }));

import { bulkFanOut, itemsOnSucceededInstances } from '@/lib/bulk-fan-out';

describe('bulkFanOut failed groups', () => {
  it('names the instances whose request failed or threw', async () => {
    const groups = new Map<string | undefined, number[]>([
      ['a', [1, 2]],
      ['b', [3]],
      [undefined, [4]],
    ]);
    const result = await bulkFanOut(groups, async (instanceId) => {
      if (instanceId === 'b') return new Response(JSON.stringify({ error: 'Root folder missing' }), { status: 400 });
      if (instanceId === undefined) throw new Error('offline');
      return new Response('{}', { status: 200 });
    });
    expect(result.ok).toBe(2);
    expect(result.fail).toBe(2);
    expect([...result.failedInstanceIds].sort()).toEqual(['b', undefined].sort());
  });

  it('leaves only the failed instances to retry', () => {
    const items = [
      { id: 1, instanceId: 'a' },
      { id: 2, instanceId: 'b' },
      { id: 3, instanceId: undefined },
      { id: 4, instanceId: 'a' },
    ];
    expect(itemsOnSucceededInstances(items, ['b']).map((i) => i.id)).toEqual([1, 3, 4]);
    expect(itemsOnSucceededInstances(items, [undefined, 'a']).map((i) => i.id)).toEqual([2]);
    expect(itemsOnSucceededInstances(items, [])).toEqual(items);
  });
});
