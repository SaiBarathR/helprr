// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: new URLSearchParams(),
  replace: vi.fn(),
  viewer: vi.fn(async () => ({ configured: true, connected: true, user: { id: 1, name: 'Tester' } })),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.search,
  usePathname: () => '/settings/anime',
}));
// A new router object on every render, the case that used to risk a repeat.
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@/lib/anilist-viewer', () => ({ fetchAnilistViewer: mocks.viewer }));

import { toast } from 'sonner';
import { AnilistConnectionCard } from '../anilist-connection-card';

let root: Root;
let queryClient: QueryClient;
const render = () => act(async () => root.render(
  <QueryClientProvider client={queryClient}><AnilistConnectionCard /></QueryClientProvider>,
));

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(() => act(() => root.unmount()));

it('says connected once and cleans the URL once, however often it re-renders first', async () => {
  mocks.search = new URLSearchParams('tab=anime&anilist=connected');
  await render();
  await render();
  await render();

  expect(toast.success).toHaveBeenCalledTimes(1);
  expect(mocks.replace).toHaveBeenCalledTimes(1);
  expect(mocks.replace).toHaveBeenCalledWith('/settings/anime?tab=anime', { scroll: false });

  // The URL is clean; a later OAuth result is handled again.
  mocks.search = new URLSearchParams('tab=anime');
  await render();
  mocks.search = new URLSearchParams('tab=anime&anilist=error&reason=denied');
  await render();
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(mocks.replace).toHaveBeenCalledTimes(2);
});
