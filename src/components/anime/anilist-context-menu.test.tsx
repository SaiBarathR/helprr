// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = vi.hoisted(() => ({ role: 'admin' }));
vi.mock('@/components/permission-provider', () => ({ useMe: () => viewer }));
vi.mock('@/components/anime/anilist-status-drawer', () => ({
  AnilistStatusDrawer: (props: { mediaId: number; loading: boolean; loadError: boolean; entry: unknown; onOpenChange: (open: boolean) => void; onRetry: () => void }) => (
    <div role="dialog" data-id={props.mediaId} data-loading={props.loading} data-error={props.loadError}>
      <span>{JSON.stringify(props.entry)}</span>
      <button onClick={() => props.onOpenChange(false)}>Close</button>
      <button onClick={props.onRetry}>Retry</button>
    </div>
  ),
}));
import { useAnilistContextMenu } from './anilist-context-menu';

let root: Root;
let queryClient: QueryClient;
let signal: AbortSignal;
let resolve: (response: Response) => void;
const fetchMock = vi.fn();

function Probe() {
  const { openAnilistDrawer, drawerNode } = useAnilistContextMenu();
  return <>
    <button onClick={() => openAnilistDrawer({ mediaId: 1, mediaTitle: 'First', mediaType: 'ANIME' })}>First</button>
    <button onClick={() => openAnilistDrawer({ mediaId: 2, mediaTitle: 'Second', mediaType: 'ANIME', entry: null })}>Known new entry</button>
    {drawerNode}
  </>;
}

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['anilist', 'viewer'], { connected: true, requiresReauth: false });
  viewer.role = 'admin';
  fetchMock.mockReset().mockImplementation((_url, options) => {
    signal = options.signal;
    return new Promise<Response>((done) => { resolve = done; });
  });
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => root.render(<QueryClientProvider client={queryClient}><Probe /></QueryClientProvider>));
});
afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  vi.unstubAllGlobals();
});

async function click(text: string) {
  await act(async () => [...document.querySelectorAll('button')].find((el) => el.textContent === text)!.click());
}
const settleQueries = () => act(async () => { await new Promise((done) => setTimeout(done, 10)); });

describe('AniList drawer loading', () => {
  it('opens before the entry response and populates the resolved entry', async () => {
    await click('First');
    expect(document.querySelector('[role="dialog"]')?.getAttribute('data-loading')).toBe('true');
    await act(async () => resolve(Response.json({ entry: { id: 9, status: 'CURRENT', score: 7, progress: 3 } })));
    await settleQueries();
    expect(document.querySelector('[role="dialog"]')?.getAttribute('data-loading')).toBe('false');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('CURRENT');
  });

  it('aborts a closed drawer and a late response cannot reopen it', async () => {
    await click('First');
    await click('Close');
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(Response.json({ entry: null })));
    await settleQueries();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('does not overwrite a different selection or refetch a known entry', async () => {
    await click('First');
    await click('Known new entry');
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(Response.json({ entry: { id: 9, status: 'CURRENT' } })));
    await settleQueries();
    expect(document.querySelector('[role="dialog"]')?.getAttribute('data-id')).toBe('2');
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('CURRENT');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('shows an error instead of treating a failed lookup as an empty entry, and retries', async () => {
    await click('First');
    await act(async () => resolve(Response.json({ error: 'Unavailable' }, { status: 503 })));
    await settleQueries();
    expect(document.querySelector('[role="dialog"]')?.getAttribute('data-error')).toBe('true');
    await click('Retry');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => resolve(Response.json({ entry: null })));
    await settleQueries();
    expect(document.querySelector('[role="dialog"]')?.getAttribute('data-error')).toBe('false');
  });

  it('keeps the admin gate for restricted users', async () => {
    viewer.role = 'member';
    await act(async () => root.render(<QueryClientProvider client={queryClient}><Probe /></QueryClientProvider>));
    await click('First');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
