// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNearViewport, WIDGET_PREFETCH_ROOT_MARGIN } from './use-near-viewport';

let root: Root;

function Probe() {
  const { ref, isNearViewport, hasEnteredViewport } = useNearViewport<HTMLDivElement>();
  return createElement('div', {
    ref,
    'data-near': String(isNearViewport),
    'data-entered': String(hasEnteredViewport),
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('useNearViewport', () => {
  it('uses the prefetch margin, tracks exit, and remembers the first entry', async () => {
    let notify: IntersectionObserverCallback | undefined;
    let observedRootMargin: string | undefined;
    const disconnect = vi.fn();

    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          notify = callback;
          observedRootMargin = options?.rootMargin;
        }
        observe() {}
        disconnect = disconnect;
        unobserve() {}
        takeRecords() {
          return [];
        }
        root = null;
        rootMargin = '';
        thresholds = [];
      },
    );

    await act(async () => root.render(createElement(Probe)));
    const probe = document.querySelector('[data-near]')!;
    expect(observedRootMargin).toBe(WIDGET_PREFETCH_ROOT_MARGIN);
    expect(probe.getAttribute('data-near')).toBe('false');

    await act(async () => {
      notify?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(probe.getAttribute('data-near')).toBe('true');
    expect(probe.getAttribute('data-entered')).toBe('true');

    await act(async () => {
      notify?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(probe.getAttribute('data-near')).toBe('false');
    expect(probe.getAttribute('data-entered')).toBe('true');
  });

  it('falls back to active when IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);

    await act(async () => root.render(createElement(Probe)));

    const probe = document.querySelector('[data-near]')!;
    expect(probe.getAttribute('data-near')).toBe('true');
    expect(probe.getAttribute('data-entered')).toBe('true');
  });
});
