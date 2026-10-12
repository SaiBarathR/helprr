// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/movies/collections',
  useSearchParams: () => new URLSearchParams(),
}));

import { resetRouteViewStateForTests, useRouteViewState } from '@/lib/hooks/use-route-view-state';
import { SearchBar } from './search-bar';

const STORAGE_KEY = 'helprr:route-views:v1';
const DEBOUNCE_MS = 700;

let container: HTMLDivElement;
let root: Root | undefined;

const box = () => container.querySelector('input')!;
const type = (text: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box(), text);
  box().dispatchEvent(new Event('input', { bubbles: true }));
});
const wait = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  sessionStorage.clear();
  resetRouteViewStateForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  vi.useRealTimers();
});

/**
 * A page that keeps its search in route view state, which is read from tab
 * storage only after hydration: the server render, and the first client render
 * that has to match it, both see the default.
 */
function StoredSearchPage({ inlineHandler }: { inlineHandler: boolean }) {
  const [search, setSearch] = useRouteViewState('search', '');
  return <SearchBar value={search} onChange={inlineHandler ? (value) => setSearch(value) : setSearch} />;
}

describe('a search restored after a reload', () => {
  // Collections passes the setter itself; Discover passes a new function every render.
  it.each([
    ['a stable handler', false],
    ['a handler recreated on every render', true],
  ])('is shown and kept, with %s', async (_label, inlineHandler) => {
    const html = renderToString(<StoredSearchPage inlineHandler={inlineHandler} />);
    expect(html).toContain('value=""');
    container.innerHTML = html;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([['/movies/collections?', { search: 'star' }]]));
    resetRouteViewStateForTests();

    await act(async () => { root = hydrateRoot(container, <StoredSearchPage inlineHandler={inlineHandler} />); });
    await wait(DEBOUNCE_MS * 2);

    expect(box().value).toBe('star');
    // Before the fix the empty box was written over the stored text here.
    window.dispatchEvent(new Event('pagehide'));
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)).toEqual([['/movies/collections?', { search: 'star' }]]);
  });
});

describe('SearchBar', () => {
  const onChange = vi.fn();
  const render = (value: string, handler: (text: string) => void = onChange) => act(async () => {
    root ??= createRoot(container);
    root.render(<SearchBar value={value} onChange={handler} />);
  });
  beforeEach(() => { onChange.mockClear(); });

  it('reports nothing for text the parent gave it', async () => {
    await render('');
    await render('batman');
    await wait(DEBOUNCE_MS * 2);
    expect(box().value).toBe('batman');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports typed text once, after the debounce', async () => {
    await render('');
    await type('bat');
    await wait(DEBOUNCE_MS - 1);
    expect(onChange).not.toHaveBeenCalled();
    await wait(1);
    expect(onChange).toHaveBeenCalledExactlyOnceWith('bat');
  });

  it('does not start the debounce again when the parent re-renders', async () => {
    await render('', (text) => onChange(text));
    await type('bat');
    await wait(DEBOUNCE_MS - 100);
    await render('', (text) => onChange(text));
    await wait(100);
    expect(onChange).toHaveBeenCalledExactlyOnceWith('bat');
  });

  it('reports a cleared box at once', async () => {
    await render('batman');
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!.click(); });
    expect(onChange).toHaveBeenCalledExactlyOnceWith('');
  });

  it('follows a reset from the parent without reporting it back', async () => {
    await render('');
    await type('bat');
    await wait(DEBOUNCE_MS);
    onChange.mockClear();
    await render('bat');
    await render('');
    await wait(DEBOUNCE_MS * 2);
    expect(box().value).toBe('');
    expect(onChange).not.toHaveBeenCalled();
  });
});
