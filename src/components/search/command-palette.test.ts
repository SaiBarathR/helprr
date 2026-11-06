// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/dynamic', () => ({
  default: () => function LazyDialogProbe() {
    return createElement('div', { 'data-command-dialog': true });
  },
}));

import { CommandPalette, SearchLoadingDialog } from '@/components/search/command-palette';
import { useSearchPalette } from '@/components/search/search-store';

let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  useSearchPalette.setState({ open: false });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe('CommandPalette', () => {
  it('shows a closable shell while the search chunk is still downloading', async () => {
    useSearchPalette.setState({ open: true });
    await act(async () => root.render(createElement(SearchLoadingDialog)));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Loading search');
    const close = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Close'))!;
    await act(async () => close.click());
    expect(useSearchPalette.getState().open).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders nothing until opened, then the lazy dialog; the hotkey toggles it', async () => {
    await act(async () => {
      root.render(createElement(CommandPalette));
    });

    // The phone entry is the tab bar's Search button; no floating edge tab.
    expect(document.querySelector('button')).toBeNull();
    expect(document.querySelector('[data-command-dialog]')).toBeNull();

    await act(async () => useSearchPalette.getState().setOpen(true));
    expect(document.querySelector('[data-command-dialog]')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'k' }));
    });
    expect(document.querySelector('[data-command-dialog]')).toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { metaKey: true, key: 'K' }));
    });
    expect(document.querySelector('[data-command-dialog]')).not.toBeNull();
  });
});
