import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { refreshAfterReconnect } from './reconnect-queries';
describe('reconnect scheduling', () => {
  it('starts foreground reads first and bounds the burst', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const started: string[] = [];
    const releases: Array<() => void> = [];
    const unsubscribers = ['other1','other2','other3','other4','radarr','me'].map((name) => {
      client.setQueryData([name], []);
      const observer = new QueryObserver(client, { queryKey: [name], queryFn: async () => { started.push(name); await new Promise<void>((resolve) => releases.push(resolve)); return []; }, staleTime: Infinity });
      return observer.subscribe(() => {});
    });
    await client.invalidateQueries({ refetchType: 'none' });
    const controller = new AbortController();
    const pending = refreshAfterReconnect(client, '/movies', controller.signal);
    await vi.waitFor(() => expect(started).toHaveLength(4));
    expect(started.slice(0, 2).sort()).toEqual(['me', 'radarr']);
    controller.abort();
    releases.forEach((release) => release());
    await pending;
    expect(started).toHaveLength(4);
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    client.clear();
  });
});
