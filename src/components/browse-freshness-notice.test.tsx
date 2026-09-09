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

it('emits safe-area padding for both landscape edges but never for the top', () => {
  // jsdom drops env() values; inspect React's actual emitted CSS instead.
  // This pins the CSS contract, not physical notch geometry.
  const markup = renderToStaticMarkup(<BrowseFreshnessBanner at={1700000000000} onRetry={() => {}} />);
  expect(markup).toContain('padding-left:max(0.75rem, env(safe-area-inset-left, 0px))');
  expect(markup).toContain('padding-right:max(0.75rem, env(safe-area-inset-right, 0px))');
  // The banner is in normal flow inside `.app-main`, which already owns the top
  // inset. Reserving it here too left ~59px of dead space above the text on an
  // iPhone PWA, so re-adding it is a regression, not a hardening.
  expect(markup).not.toContain('safe-area-inset-top');
});
