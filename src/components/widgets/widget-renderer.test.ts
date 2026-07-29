// @vitest-environment jsdom

import { act, createElement, lazy, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetDefinition, WidgetInstance, WidgetProps } from '@/lib/widgets/types';

const mocks = vi.hoisted(() => ({
  getWidgetComponent: vi.fn(),
  getWidgetDefinition: vi.fn(),
  resetWidgetComponent: vi.fn(),
}));

vi.mock('@/lib/store', () => ({
  useUIStore: (selector: (state: { discoverLayout: null }) => unknown) =>
    selector({ discoverLayout: null }),
}));
vi.mock('@/lib/widgets/registry', () => ({
  getWidgetDefinition: mocks.getWidgetDefinition,
}));
vi.mock('./widget-loaders', () => ({
  getWidgetComponent: mocks.getWidgetComponent,
  resetWidgetComponent: mocks.resetWidgetComponent,
}));

import { WidgetRenderer } from './widget-renderer';

const definition: WidgetDefinition = {
  id: 'stats-grid',
  name: 'Stats Overview',
  description: 'Overview',
  icon: 'BarChart3',
  category: 'overview',
  defaultDesktopSpan: { colSpan: 4, rowSpan: 2 },
  defaultMobileSpan: { colSpan: 2, rowSpan: 1 },
  defaultRefreshIntervalSecs: 30,
};

const instance: WidgetInstance = {
  id: 'stats-grid-1',
  widgetId: 'stats-grid',
  colSpan: 4,
  rowSpan: 2,
};

let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  mocks.getWidgetDefinition.mockReturnValue(definition);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderWidget() {
  await act(async () => {
    root.render(createElement(WidgetRenderer, { instance, rowSpan: 2 }));
  });
}

describe('WidgetRenderer lazy states', () => {
  it('keeps a dimensionally stable skeleton while the widget chunk loads', async () => {
    mocks.getWidgetComponent.mockReturnValue(lazy(() => new Promise(() => undefined)));

    await renderWidget();

    const skeleton = document.querySelector('[data-slot="skeleton"]');
    expect(skeleton).not.toBeNull();
    expect(skeleton?.className).toContain('h-[280px]');
  });

  it('renders a successfully loaded widget', async () => {
    const LoadedWidget: ComponentType<WidgetProps> = ({ refreshInterval }) =>
      createElement('div', null, `Loaded every ${refreshInterval}ms`);
    mocks.getWidgetComponent.mockReturnValue(lazy(async () => ({ default: LoadedWidget })));

    await renderWidget();

    expect(document.body.textContent).toContain('Loaded every 30000ms');
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
  });

  it('identifies a failed widget and retries with a fresh lazy component', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const FailedWidget = lazy(async () => {
      throw new Error('chunk failed');
    });
    const LoadedWidget: ComponentType<WidgetProps> = () =>
      createElement('div', null, 'Recovered widget');
    mocks.getWidgetComponent
      .mockReturnValueOnce(FailedWidget)
      .mockReturnValue(lazy(async () => ({ default: LoadedWidget })));

    await renderWidget();

    expect(document.body.textContent).toContain('Widget stats-grid-1 failed to load');
    const retry = [...document.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Retry'));
    await act(async () => {
      retry?.click();
    });

    expect(mocks.resetWidgetComponent).toHaveBeenCalledWith('stats-grid');
    expect(document.body.textContent).toContain('Recovered widget');
  });

  it('reloads the document when a deployed widget chunk is stale', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const chunkError = new Error('Loading chunk 123 failed');
    chunkError.name = 'ChunkLoadError';
    mocks.getWidgetComponent.mockReturnValue(lazy(async () => {
      throw chunkError;
    }));
    const reload = vi.fn();
    const deleteCache = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('location', { reload });
    vi.stubGlobal('caches', { delete: deleteCache });

    await renderWidget();

    const retry = [...document.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Retry'));
    await act(async () => {
      retry?.click();
    });

    expect(deleteCache).toHaveBeenCalledWith('pages');
    expect(reload).toHaveBeenCalledOnce();
    expect(mocks.resetWidgetComponent).not.toHaveBeenCalled();
  });

  it('preserves the unknown-widget fallback', async () => {
    mocks.getWidgetDefinition.mockReturnValue(undefined);

    await renderWidget();

    expect(document.body.textContent).toContain('Unknown widget: stats-grid');
    expect(mocks.getWidgetComponent).not.toHaveBeenCalled();
  });
});
