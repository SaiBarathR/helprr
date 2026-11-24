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
  Reflect.deleteProperty(document, 'elementsFromPoint');
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

it("follows a flow's own bar pinned under the page header's, and skips a hidden one", async () => {
  main.append(toolbar(52));
  renderHook(() => usePageToolbarBottom(true));
  expect(value()).toBe('52px');

  // Interactive Search's filters, pinned below the header (its own top).
  const flowBar = toolbar(96, '52px');
  main.append(flowBar);
  await waitFor(() => expect(value()).toBe('148px'));

  // A bar laid out but hidden (display: none) does not count.
  main.append(toolbar(0, '200px'));
  flowBar.remove();
  await waitFor(() => expect(value()).toBe('52px'));
});

it('keeps toasts below a clearance bar while it shows under the toolbar, and follows it as the page scrolls', async () => {
  main.append(toolbar(96));
  // The Torrents selection bar, in the page's flow under the toolbar.
  const bar = document.createElement('div');
  bar.dataset.toastClearance = '';
  Object.defineProperty(bar, 'offsetHeight', { value: 48, configurable: true });
  let barBottom = 160;
  bar.getBoundingClientRect = () => ({ bottom: barBottom } as DOMRect);
  renderHook(() => usePageToolbarBottom(true));
  expect(value()).toBe('96px');

  main.append(bar);
  await waitFor(() => expect(value()).toBe('160px'));

  // Scrolled up under the sticky toolbar: the toolbar's bottom counts again.
  barBottom = 40;
  document.dispatchEvent(new Event('scroll'));
  await waitFor(() => expect(value()).toBe('96px'));

  // A page that scrolls in an element (scroll does not bubble).
  barBottom = 150;
  main.dispatchEvent(new Event('scroll'));
  await waitFor(() => expect(value()).toBe('150px'));

  bar.remove();
  barBottom = 300;
  await waitFor(() => expect(value()).toBe('96px'));
});

it('lets toasts back up to the toolbar while a sheet covers the clearance bar, but not for a toast over it', async () => {
  main.append(toolbar(96));
  const bar = document.createElement('div');
  bar.dataset.toastClearance = '';
  bar.append(document.createElement('button'));
  Object.defineProperty(bar, 'offsetHeight', { value: 48, configurable: true });
  bar.getBoundingClientRect = () => ({ left: 0, width: 300, bottom: 160 } as DOMRect);
  const toaster = document.createElement('section');
  toaster.dataset.sonnerToaster = '';
  const toast = toaster.appendChild(document.createElement('li'));
  const sheet = document.createElement('div');
  let onTop: Element[] = [toast, bar.firstElementChild!, bar];
  document.elementsFromPoint = () => onTop;
  main.append(bar);
  renderHook(() => usePageToolbarBottom(true));
  expect(value()).toBe('160px');

  // A sheet opens over the page.
  onTop = [toast, sheet, bar];
  document.body.append(sheet);
  await waitFor(() => expect(value()).toBe('96px'));

  onTop = [bar];
  sheet.remove();
  await waitFor(() => expect(value()).toBe('160px'));
});
