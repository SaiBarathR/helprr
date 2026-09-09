import { describe, expect, it, vi } from 'vitest';
import { cachedJellyfinCatalog, invalidateJellyfinCatalog } from './jellyfin-catalog';
describe('identity scoped catalog reads', () => {
  it('deduplicates reads, isolates identities and invalidates in-flight fills', async () => {
    let release!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>((resolve) => { release = resolve; }));
    const first = cachedJellyfinCatalog('cache-test-user', 'server:user1', 'home', load);
    const same = cachedJellyfinCatalog('cache-test-user', 'server:user1', 'home', load);
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(await cachedJellyfinCatalog('cache-test-user', 'server:user2', 'home', async () => 'other')).toBe('other');
    invalidateJellyfinCatalog('cache-test-user');
    expect(await cachedJellyfinCatalog('cache-test-user', 'server:user1', 'home', async () => 'new')).toBe('new');
    release('old'); await Promise.all([first, same]);
    expect(await cachedJellyfinCatalog('cache-test-user', 'server:user1', 'home', async () => 'unexpected')).toBe('new');
  });
});
