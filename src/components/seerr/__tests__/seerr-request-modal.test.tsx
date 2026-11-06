// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  me: null as null | { role: string; seerrUserId: string | null },
  tags: { defaultTags: [] as number[], tags: [] as { id: number; label: string }[] },
  service: {} as Record<string, unknown>,
  posts: [] as Array<{ url: string; body: Record<string, unknown> }>,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/permission-provider', () => ({ useMe: () => mocks.me }));

import { SeerrRequestModal } from '../seerr-request-modal';

let root: Root;
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
let queryClient: QueryClient;
const render = (mode: 'create' | 'edit' = 'create') => act(async () => root.render(
  <QueryClientProvider client={queryClient}>
    <SeerrRequestModal open onOpenChange={() => {}} mode={mode} requestId={11} mediaType="movie" tmdbId={603} title="The Matrix" />
  </QueryClientProvider>,
));
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

beforeEach(() => {
  mocks.tags = { defaultTags: [], tags: [] };
  mocks.service = {};
  mocks.posts = [];
  localStorage.clear();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (init?.method === 'POST' || init?.method === 'PUT') {
      mocks.posts.push({ url, body: JSON.parse(String(init.body)) });
      return json({});
    }
    if (url.startsWith('/api/seerr/service/')) return json({ serverId: 1, defaultProfileId: 4, defaultRootFolder: '/movies', profiles: [], rootFolders: [], ...mocks.tags, ...mocks.service });
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

it('keeps default tags the user removed when their identity arrives', async () => {
  mocks.me = null;
  mocks.tags = { defaultTags: [5], tags: [{ id: 5, label: 'anime' }, { id: 6, label: '4k' }] };
  await render();
  await settle();
  const selectedTag = () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'anime');
  await vi.waitFor(() => expect(selectedTag()).toBeTruthy());
  await act(async () => selectedTag()!.click());
  expect(selectedTag()).toBeUndefined();

  mocks.me = { role: 'admin', seerrUserId: '7' };
  await render();
  await settle();

  expect(selectedTag()).toBeUndefined();
  expect(document.body.textContent).toContain('Owner');
});

const submitButton = () => [...document.querySelectorAll('button')].find((b) => ['Request', 'Save'].includes(b.textContent ?? ''));
async function submitAndRead() {
  await vi.waitFor(() => expect(submitButton()?.disabled).toBe(false));
  await settle();
  await act(async () => submitButton()!.click());
  await vi.waitFor(() => expect(mocks.posts).toHaveLength(1));
  return mocks.posts[0];
}
const servers = {
  profiles: [{ id: 4, name: '4k Max OTT Quality' }, { id: 6, name: 'HD' }],
  rootFolders: [{ id: 1, path: '/movies' }, { id: 2, path: '/movies-kids' }],
};

it('remembers the last profile and folder requested on that Seerr server', async () => {
  mocks.me = { role: 'member', seerrUserId: null };
  mocks.service = servers;
  localStorage.setItem('helprr-add-defaults:seerr-radarr:1', JSON.stringify({ profileId: '6', rootFolder: '/movies-kids' }));
  await render();

  const post = await submitAndRead();
  expect(post.url).toBe('/api/seerr/requests');
  expect(post.body).toEqual(expect.objectContaining({ serverId: 1, profileId: 6, rootFolder: '/movies-kids' }));
  expect(JSON.parse(localStorage.getItem('helprr-add-defaults:seerr-radarr:1')!)).toEqual({ profileId: '6', rootFolder: '/movies-kids' });
});

it("falls back to Seerr's default when the remembered profile or folder is gone, or saved for another server", async () => {
  mocks.me = { role: 'member', seerrUserId: null };
  mocks.service = servers;
  localStorage.setItem('helprr-add-defaults:seerr-radarr:1', JSON.stringify({ profileId: '99', rootFolder: '/gone' }));
  localStorage.setItem('helprr-add-defaults:seerr-radarr:2', JSON.stringify({ profileId: '6', rootFolder: '/movies-kids' }));
  await render();

  const post = await submitAndRead();
  expect(post.body).toEqual(expect.objectContaining({ profileId: 4, rootFolder: '/movies' }));
});

it('does not apply the remembered choice when editing an existing request', async () => {
  mocks.me = { role: 'member', seerrUserId: null };
  mocks.service = servers;
  localStorage.setItem('helprr-add-defaults:seerr-radarr:1', JSON.stringify({ profileId: '6', rootFolder: '/movies-kids' }));
  await render('edit');

  const post = await submitAndRead();
  expect(post.url).toBe('/api/seerr/requests/11');
  expect(post.body).toEqual(expect.objectContaining({ profileId: 4, rootFolder: '/movies' }));
});
