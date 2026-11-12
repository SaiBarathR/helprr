// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { BrowseFreshnessBanner, BrowseFreshnessNotice } from './browse-freshness-notice';
import { recordBrowseFreshness } from '@/lib/browse-freshness';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('shows saved provenance, retries, and disappears only after fresh data arrives', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onRetry = vi.fn();
  try {
    act(() => root.render(<BrowseFreshnessNotice onRetry={onRetry} />));
    expect(container.querySelector('[role="status"]')).toBeNull();
    act(() => recordBrowseFreshness('/api/test', new Response('{}', { headers: {
      'x-helprr-stale': '1', 'x-helprr-snapshot-at': '1700000000000',
    } })));
    expect(container.textContent).toContain('Showing saved browse data');
    const notice = container.querySelector<HTMLElement>('[role="status"]')!;
    // Fixed above the bottom bar, so a page scrolled away from its top (Calendar
    // jumps to today) still shows it.
    expect(notice.parentElement!.className.split(' ')).toContain('fixed');
    expect(notice.parentElement!.style.bottom).toContain('var(--footer-height)');
    const retry = container.querySelector('button')!;
    expect(getComputedStyle(retry).minHeight).toBe('44px');
    expect(getComputedStyle(retry).minWidth).toBe('44px');
    expect(getComputedStyle(retry).flexShrink).toBe('0');
    act(() => retry.click());
    expect(onRetry).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    act(() => recordBrowseFreshness('/api/test', new Response('{}')));
    expect(container.querySelector('[role="status"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    recordBrowseFreshness('/api/test', new Response('{}'));
    container.remove();
  }
});

it('keeps clear of a landscape notch, and leaves the top inset alone', () => {
  // jsdom drops env() values; inspect React's actual emitted markup instead.
  const markup = renderToStaticMarkup(<BrowseFreshnessBanner at={1700000000000} onRetry={() => {}} />);
  // Fixed, out of .app-main's flow: it pads itself for the side insets. It sits
  // at the bottom, above the bar (whose height has the home indicator), so the
  // top inset that once left ~59px of dead space is not used.
  expect(markup).toContain('env(safe-area-inset-left');
  expect(markup).toContain('env(safe-area-inset-right');
  expect(markup).not.toContain('safe-area-inset-top');
});
