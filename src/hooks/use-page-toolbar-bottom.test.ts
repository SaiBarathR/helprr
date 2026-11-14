// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePageToolbarBottom } from './use-page-toolbar-bottom';

const value = () => document.documentElement.style.getPropertyValue('--page-toolbar-bottom');

function toolbar(height: number, top = '0px') {
  const el = document.createElement('div');
  el.className = 'page-toolbar';
  el.style.top = top;
  Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true });
  return el;
}

let main: HTMLElement;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  main = document.createElement('main');
  document.body.append(main);
});
afterEach(() => {
  main.remove();
  vi.unstubAllGlobals();
});

it("is where the page's toolbar ends once stuck: its pinned top plus its height", () => {
  // Calendar's two-row phone toolbar under the top nav.
  main.append(toolbar(96, '48px'));
  const { unmount } = renderHook(() => usePageToolbarBottom(true));
  expect(value()).toBe('144px');
  unmount();
  expect(value()).toBe('');
});

it("follows the next page's toolbar, and clears on a page without one", async () => {
  const first = toolbar(96);
  main.append(first);
  renderHook(() => usePageToolbarBottom(true));
  expect(value()).toBe('96px');

  first.remove();
  main.append(toolbar(52));
  await waitFor(() => expect(value()).toBe('52px'));

  main.replaceChildren();
  await waitFor(() => expect(value()).toBe(''));
});

it('does nothing off a phone, where toasts come from the bottom', () => {
  main.append(toolbar(96));
  renderHook(() => usePageToolbarBottom(false));
  expect(value()).toBe('');
});
