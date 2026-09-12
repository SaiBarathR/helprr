import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { fetchAnilistViewer } from './anilist-viewer';

afterEach(() => vi.unstubAllGlobals());

it('preserves a connected viewer in the shared cache after a transient failure', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queryKey = ['anilist', 'viewer'];
  const viewer = { configured: true, connected: true, requiresReauth: false, user: { name: 'Viewer' } };
  client.setQueryData(queryKey, viewer);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
  await expect(client.fetchQuery({ queryKey, queryFn: () => fetchAnilistViewer() })).rejects.toThrow();
  expect(client.getQueryData(queryKey)).toEqual(viewer);
  client.clear();
});

it('retains the complete server response and genuine disconnection', async () => {
  const viewer = { configured: true, connected: false, requiresReauth: true, user: { name: 'Viewer' } };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(viewer)));
  expect(await fetchAnilistViewer()).toEqual(viewer);
});
