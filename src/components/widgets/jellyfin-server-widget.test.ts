// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tasks: null as unknown[] | null,
}));

vi.mock('@/lib/widgets/use-element-size', () => ({
  useElementSize: () => ({ ref: { current: null }, width: 320 }),
}));
vi.mock('@/lib/widgets/use-widget-data', () => ({
  useWidgetData: ({ cacheKey }: { cacheKey: string }) => ({
    data: cacheKey === 'jellyfin-system'
      ? {
          ServerName: 'Jellyfin',
          Version: '10.10.7',
          HasPendingRestart: false,
          HasUpdateAvailable: false,
        }
      : mocks.tasks,
    loading: false,
    error: null,
    refresh: vi.fn(async () => undefined),
  }),
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: () => null,
}));

import { JellyfinServerWidget } from './jellyfin-server-widget';

let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.tasks = null;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe('JellyfinServerWidget', () => {
  it('keeps library scanning disabled until the current task state is known', async () => {
    await act(async () => {
      root.render(createElement(JellyfinServerWidget, { refreshInterval: 30_000 }));
    });

    let scanButton = [...document.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Scan Libraries'));
    expect(scanButton?.disabled).toBe(true);

    mocks.tasks = [];
    await act(async () => {
      root.render(createElement(JellyfinServerWidget, { refreshInterval: 30_000 }));
    });

    scanButton = [...document.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Scan Libraries'));
    expect(scanButton?.disabled).toBe(false);
  });
});
