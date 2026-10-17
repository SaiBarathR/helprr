// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ children }: { children: React.ReactNode }) => children,
  DrawerContent: ({ children }: { children: React.ReactNode }) => children,
  DrawerHeader: ({ children }: { children: React.ReactNode }) => children,
  DrawerTitle: ({ children }: { children: React.ReactNode }) => children,
  DrawerDescription: ({ children }: { children: React.ReactNode }) => children,
  DrawerFooter: ({ children }: { children: React.ReactNode }) => children,
}));

import { SonarrMapDrawer } from '../sonarr-map-drawer';

const mappings = [{ sonarrInstanceId: 'sonarr-1', sonarrSeriesId: 12, sonarrInstanceLabel: 'Sonarr', title: 'Frieren' }];
let root: Root;
const fetchMock = vi.fn(async (url: string) => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  if (url.startsWith('/api/anime/154587/sonarr')) return json({ mappings });
  return json([]);
});
const render = (open: boolean, onMappingsChanged: (m: unknown[]) => void) => act(async () => root.render(
  <SonarrMapDrawer open={open} onOpenChange={() => {}} anilistMediaId={154587} animeTitle="Frieren" onMappingsChanged={onMappingsChanged} />,
));
const loads = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/anime/154587/sonarr')).length;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it('does not reload for a new callback, and tells the latest one', async () => {
  const first = vi.fn();
  await render(true, first);
  await vi.waitFor(() => expect(first).toHaveBeenCalledWith(mappings));
  expect(loads()).toBe(1);

  // The page re-renders with a new callback: no new load.
  const second = vi.fn();
  await render(true, second);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(loads()).toBe(1);

  // The next open reports to the callback the page holds now.
  await render(false, second);
  await render(true, second);
  await vi.waitFor(() => expect(second).toHaveBeenCalledWith(mappings));
  expect(first).toHaveBeenCalledTimes(1);
  expect(loads()).toBe(2);
});
