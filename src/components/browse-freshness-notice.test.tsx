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
    // Normal flow reserves the notice's wrapped height instead of obscuring nav.
    expect(getComputedStyle(notice).position).toBe('relative');
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

it('leaves every safe-area inset to .app-main', () => {
  // jsdom drops env() values; inspect React's actual emitted markup instead.
  const markup = renderToStaticMarkup(<BrowseFreshnessBanner at={1700000000000} onRetry={() => {}} />);
  // The banner is in normal flow inside `.app-main`, which already owns the top
  // inset and the landscape left/right ones. Reserving the top one here too left
  // ~59px of dead space above the text on an iPhone PWA, and the side ones
  // would double the landscape gutter.
  expect(markup).not.toContain('safe-area-inset');
});
