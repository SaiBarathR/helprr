// @vitest-environment jsdom

import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => router }));
// Model the documented onNavigate boundary; Next owns native click semantics.
vi.mock('next/link', () => ({
  default: ({ onNavigate, prefetch, replace: _replace, scroll: _scroll, ...props }: ComponentProps<'a'> & {
    onNavigate?: (event: { preventDefault: () => void }) => void;
    prefetch?: boolean | null; replace?: boolean; scroll?: boolean;
  }) => <a {...props} data-replace={String(_replace)} data-scroll={String(_scroll)} data-prefetch={String(prefetch)} onClick={(event) => {
    props.onClick?.(event);
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || props.target === '_blank' || props.download) { event.preventDefault(); return; }
    if (new URL(event.currentTarget.href).origin !== window.location.origin) return;
    onNavigate?.({ preventDefault: () => event.preventDefault() });
  }} />,
}));
import AppLink from './app-link';

let root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/dashboard');
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => { await act(async () => root.unmount()); });

describe('AppLink', () => {
  it('uses shared navigation with the full destination and preserves replace/scroll options', async () => {
    await act(async () => root.render(<AppLink href="/movies/12?instance=second#files" replace scroll={false}>Open</AppLink>));
    await act(async () => document.querySelector('a')!.click());
    expect(router.replace).toHaveBeenCalledWith('/movies/12?instance=second#files', { scroll: false });
    expect(document.querySelector('a')!.dataset.prefetch).toBe('false');
  });

  it('lets primary navigation opt into partial prefetching and forwards its ref', async () => {
    const ref = { current: null as HTMLAnchorElement | null };
    await act(async () => root.render(<AppLink href="/movies" prefetch={null} ref={ref}>Movies</AppLink>));
    expect(ref.current).toBe(document.querySelector('a'));
    expect(ref.current!.dataset.prefetch).toBe('null');
  });

  it('respects a cancelled navigation', async () => {
    await act(async () => root.render(<AppLink href="/movies" onNavigate={(event) => event.preventDefault()}>Open</AppLink>));
    await act(async () => document.querySelector('a')!.click());
    expect(router.push).not.toHaveBeenCalled();
  });

  it('leaves modified clicks with the browser', async () => {
    await act(async () => root.render(<AppLink href="/movies">Open</AppLink>));
    await act(async () => document.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })));
    expect(router.push).not.toHaveBeenCalled();
  });
});
