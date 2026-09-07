// @vitest-environment jsdom

import { act, createContext, Suspense, use, useContext, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(),
}));
const PathContext = createContext('/dashboard');
vi.mock('next/navigation', () => ({
  useRouter: () => native,
  usePathname: () => useContext(PathContext),
}));
vi.mock('@/components/layout/bottom-nav', () => ({ BottomNav: () => <nav>Tabs stay available</nav> }));
vi.mock('@/components/notifications/push-reenable-banner', () => ({ PushReenableBanner: () => null }));

import { NavigationProvider, useAppRouter } from './navigation-provider';
import { AppShell } from './app-shell';

let root: Root;
let commit: (pathname: string, ready: Promise<string>) => void;
let ready: Promise<string>;
let resolve: (value: string) => void;

function Controls() {
  const router = useAppRouter();
  return <>
    <button onClick={() => router.push('/movies')}>Movies</button>
    <button onClick={() => router.push('/series')}>Series</button>
    <button onClick={() => router.replace('/dashboard?filter=active', { scroll: false })}>Filter</button>
    <button onClick={() => router.back()}>Back</button>
  </>;
}

function Page({ response }: { response: Promise<string> | null }) {
  const name = response ? use(response) : 'Dashboard content';
  return <><p>{name}</p><input aria-label="Draft" defaultValue="keep me" /></>;
}

function Harness() {
  const [page, setPage] = useState<{ path: string; response: Promise<string> | null }>({ path: '/dashboard', response: null });
  useEffect(() => { commit = (path, response) => setPage({ path, response }); }, []);
  return <PathContext.Provider value={page.path}>
    <NavigationProvider>
      <Controls />
      <AppShell><Suspense fallback={<p>Route loading</p>}><Page response={page.response} /></Suspense></AppShell>
    </NavigationProvider>
  </PathContext.Provider>;
}

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/dashboard');
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  ready = new Promise<string>((done) => { resolve = done; });
  native.push.mockImplementation((path: string) => commit(path, ready));
  native.replace.mockImplementation(() => commit('/dashboard', ready));
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find((el) => el.textContent === text)!;
  await act(async () => button.click());
}

describe('app navigation feedback', () => {
  it('paints the destination before the route responds, then displays its content', async () => {
    const draft = document.querySelector('input')!;
    draft.value = 'unsaved';
    await click('Movies');
    expect(document.querySelector('[data-navigation-loading]')?.textContent).toContain('Movies');
    expect(draft.closest('[hidden]')).not.toBeNull();
    expect(document.querySelector('nav')?.textContent).toContain('Tabs stay available');
    await act(async () => resolve('Movies content'));
    expect(document.querySelector('[data-navigation-loading]')).toBeNull();
    expect(document.body.textContent).toContain('Movies content');
  });

  it('keeps the current form visible during a same-page query update', async () => {
    const draft = document.querySelector('input')!;
    draft.value = 'unsaved';
    await click('Filter');
    expect(native.replace).toHaveBeenCalledWith('/dashboard?filter=active', { scroll: false });
    expect(document.querySelector('[data-navigation-loading]')).toBeNull();
    expect(draft.closest('[hidden]')).toBeNull();
    expect(draft.value).toBe('unsaved');
    await act(async () => resolve('Filtered dashboard'));
  });

  it('allows another destination while the first request is unresolved', async () => {
    await click('Movies');
    await click('Series');
    expect(document.querySelector('[data-navigation-loading]')?.textContent).toContain('TV Series');
    await act(async () => resolve('Series content'));
    expect(document.querySelector('[data-navigation-loading]')).toBeNull();
    expect(document.body.textContent).toContain('Series content');
  });

  it('handles browser history and clears feedback once that route commits', async () => {
    await click('Back');
    expect(native.back).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-navigation-loading]')).not.toBeNull();
    await act(async () => {
      window.history.replaceState({}, '', '/movies');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(document.querySelector('[data-navigation-loading]')?.textContent).toContain('Movies');
    await act(async () => { resolve('Previous page'); commit('/movies', ready); });
    expect(document.querySelector('[data-navigation-loading]')).toBeNull();
  });

  it('restores the current page when Back has no history entry', async () => {
    vi.useFakeTimers();
    await click('Back');
    await act(async () => vi.advanceTimersByTime(1000));
    expect(document.querySelector('[data-navigation-loading]')).toBeNull();
    expect(document.querySelector('input')?.closest('[hidden]')).toBeNull();
  });
});
