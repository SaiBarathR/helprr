// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/dynamic', () => ({
  default: () => function LazyDialogProbe() {
    return createElement('div', { 'data-command-dialog': true });
  },
}));

import { CommandPalette } from '@/components/search/command-palette';
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
  it('keeps the launcher lightweight and opens the lazy dialog from button or hotkey', async () => {
    await act(async () => {
      root.render(createElement(CommandPalette));
    });

    const launcher = document.querySelector('[aria-label="Search"]') as HTMLButtonElement;
    expect(launcher).toBeInstanceOf(HTMLButtonElement);
    expect(document.querySelector('[data-command-dialog]')).toBeNull();

    await act(async () => launcher.click());
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
