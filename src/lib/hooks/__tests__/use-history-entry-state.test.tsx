// @vitest-environment jsdom
import { act, useInsertionEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useHistoryEntryState } from '../use-history-entry-state';

const KEY = 'browse';
let root: Root;

// Stands in for Next's HistoryUpdater: after a page renders for a navigation,
// it writes the entry in an insertion effect, with only its own keys.
type Nav = { type: 'push' | 'replace'; url: string };
function NextHistory({ nav }: { nav: Nav | null }) {
  useInsertionEffect(() => {
    if (!nav) return;
    if (nav.type === 'push') window.history.pushState({ __NA: true }, '', nav.url);
    else window.history.replaceState({ __NA: true }, '', nav.url);
  }, [nav]);
  return null;
}
function Page() {
  const [browse, setBrowse] = useHistoryEntryState(KEY, false);
  return <button onClick={() => setBrowse(true)}>{browse ? 'grid' : 'carousels'}</button>;
}
async function render(nav: Nav | null = null, mounted = true) {
  await act(async () => root.render(<><NextHistory nav={nav} />{mounted && <Page />}</>));
}
const shown = () => document.querySelector('button')?.textContent;
// Tapping a pill.
const browse = () => act(async () => document.querySelector('button')!.click());
const stored = () => (window.history.state as Record<string, unknown> | null)?.[KEY];

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, '', '/discover');
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(() => act(() => root.unmount()));

it('keeps the value when Next rewrites the same entry, so Back finds it', async () => {
  await render();
  await browse();
  expect(shown()).toBe('grid');

  // Tapping the page's own nav link: Next replaces the entry's state.
  await render({ type: 'replace', url: '/discover' });
  expect(shown()).toBe('grid');
  expect(stored()).toBe(true);

  // Open a title, then Back to this entry.
  await render({ type: 'push', url: '/discover/movie/1' }, false);
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
  });
  await render(null);
  expect(shown()).toBe('grid');
});

it('starts a new address from what its entry holds while the page stays mounted', async () => {
  window.history.replaceState(null, '', '/discover?contentType=all');
  await render();
  await browse();

  // Leaving a link view for plain Discover, by a new entry or by replacing this one.
  await render({ type: 'push', url: '/discover' });
  expect(shown()).toBe('carousels');
  await browse();
  await render({ type: 'replace', url: '/discover?genre=1' });
  expect(shown()).toBe('carousels');
  expect(stored()).toBeUndefined();
});

it('shows what each entry holds on Back and Forward while mounted', async () => {
  window.history.replaceState(null, '', '/discover?contentType=all');
  await render();
  await browse();
  await render({ type: 'push', url: '/discover' });
  expect(shown()).toBe('carousels');

  const traverse = (step: () => void) => act(async () => {
    const landed = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
    step();
    await landed;
  });
  await traverse(() => window.history.back());
  expect(shown()).toBe('grid');
  await traverse(() => window.history.forward());
  expect(shown()).toBe('carousels');
});
