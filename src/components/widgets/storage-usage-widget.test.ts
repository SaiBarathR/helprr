// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  diskSpace: [
    { path: '/media/one', label: 'one', freeSpace: 100, totalSpace: 1_000 },
    { path: '/media/two', label: 'two', freeSpace: 200, totalSpace: 2_000 },
    { path: '/media/three', label: 'three', freeSpace: 300, totalSpace: 3_000 },
    { path: '/media/four', label: 'four', freeSpace: 400, totalSpace: 4_000 },
  ],
}));

vi.mock('@/lib/widgets/use-widget-data', () => ({
  useWidgetData: ({ cacheKey }: { cacheKey: string }) => ({
    data: cacheKey === 'services-stats'
      ? { diskSpace: mocks.diskSpace }
      : { one: { direction: 'flat', perDayBytes: 0, daysUntilFull: null } },
  }),
}));

import { StorageUsageWidget } from './storage-usage-widget';

let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe('StorageUsageWidget', () => {
  it('keeps every disk row inside a height-constrained scroll region', async () => {
    await act(async () => {
      root.render(createElement(StorageUsageWidget, { refreshInterval: 30_000 }));
    });

    const widget = document.getElementById('root')?.firstElementChild as HTMLDivElement;
    const scrollRegion = widget.querySelector('.scroll-fade-y') as HTMLDivElement;

    expect(widget.style.height).toBe('100%');
    expect(widget.style.minHeight).toBe('0px');
    expect(scrollRegion.classList.contains('no-scrollbar')).toBe(true);
    expect(scrollRegion.style.flex).toBe('1 1 0%');
    expect(scrollRegion.style.minHeight).toBe('0px');
    expect(scrollRegion.style.overflowY).toBe('auto');
    expect(scrollRegion.textContent).toContain('/media/one');
    expect(scrollRegion.textContent).toContain('/media/four');
  });
});
