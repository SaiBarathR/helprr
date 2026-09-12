// @vitest-environment jsdom
import { act, createContext, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const Route = createContext('/discover');
vi.mock('next/navigation', () => ({
  usePathname: () => useContext(Route).split('?')[0],
  useSearchParams: () => new URLSearchParams(useContext(Route).split('?')[1]),
}));
import { resetRouteViewStateForTests, useRouteViewState } from './use-route-view-state';

let root: Root;
function Page() {
  const [section, setSection] = useRouteViewState('section', 'landing');
  const [expanded, setExpanded] = useRouteViewState<Set<number>>('expanded', () => new Set());
  return <>
    <button onClick={() => setSection('popular')}>{section}</button>
    <button onClick={() => setExpanded((old) => new Set([...old, 2]))}>{[...expanded].join(',') || 'closed'}</button>
  </>;
}
async function render(route: string, mounted = true) {
  await act(async () => root.render(<Route.Provider value={route}>{mounted && <Page />}</Route.Provider>));
}
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  resetRouteViewStateForTests();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => { await act(async () => root.unmount()); });

it('reconstructs section and expanded content after navigating away and remounting', async () => {
  await render('/discover');
  await act(async () => { document.querySelectorAll('button')[0].click(); document.querySelectorAll('button')[1].click(); });
  await render('/discover/movie/123', false);
  await render('/discover');
  expect(document.body.textContent).toBe('popular2');
});

it('isolates dynamic routes and service instances even when React reuses the component', async () => {
  await render('/series/1?instance=alpha');
  await act(async () => document.querySelectorAll('button')[1].click());
  await render('/series/1?instance=beta');
  expect(document.body.textContent).toBe('landingclosed');
  await render('/series/2?instance=alpha');
  expect(document.body.textContent).toBe('landingclosed');
  await render('/series/1?instance=alpha');
  expect(document.body.textContent).toBe('landing2');
});

it('restores serializable Set state from tab storage after a reload', async () => {
  await render('/series/1');
  await act(async () => document.querySelectorAll('button')[1].click());
  await render('/series/1', false);
  resetRouteViewStateForTests();
  await render('/series/1');
  expect(document.body.textContent).toBe('landing2');
});

it('keeps navigating when storage is denied', async () => {
  const denied = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
  try {
    await render('/discover');
    await act(async () => document.querySelectorAll('button')[0].click());
    await render('/discover', false);
    await render('/discover');
    expect(document.body.textContent).toBe('popularclosed');
  } finally { denied.mockRestore(); }
});
