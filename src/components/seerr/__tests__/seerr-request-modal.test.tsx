// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ me: null as null | { role: string; seerrUserId: string | null } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/permission-provider', () => ({ useMe: () => mocks.me }));

import { SeerrRequestModal } from '../seerr-request-modal';

let root: Root;
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
let queryClient: QueryClient;
const render = () => act(async () => root.render(
  <QueryClientProvider client={queryClient}>
    <SeerrRequestModal open onOpenChange={() => {}} mode="create" mediaType="movie" tmdbId={603} title="The Matrix" />
  </QueryClientProvider>,
));
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.startsWith('/api/seerr/service/')) return json({ serverId: 1, defaultProfileId: 4, defaultRootFolder: '/movies', defaultTags: [] , profiles: [], rootFolders: [], tags: [] });
    if (url.startsWith('/api/seerr/users')) return json({ results: [{ id: 3, displayName: 'Someone else' }, { id: 7, displayName: 'Owner' }] });
    return new Response(null, { status: 404 });
  }));
  queryClient = client();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it('requests as the signed-in user even when their identity arrives after the service data', async () => {
  mocks.me = null;
  await render();
  await settle();

  mocks.me = { role: 'admin', seerrUserId: '7' };
  await render();
  await vi.waitFor(() => expect(document.body.textContent).toContain('Request As'));
  await settle();

  expect(document.querySelector('[role="combobox"][data-placeholder]')).toBeNull();
  expect(document.body.textContent).toContain('Owner');
});
