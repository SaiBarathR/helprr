// @vitest-environment jsdom

import { act, createElement, lazy, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetAvailabilityProvider } from '@/lib/widgets/widget-availability-context';
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
let queryClient: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mocks.getWidgetDefinition.mockReturnValue(definition);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const retryButton = () => [...document.querySelectorAll('button')]
  .find((button) => button.textContent?.includes('Retry'));

async function renderWidget({
  editMode = false,
  services = ['JELLYFIN', 'PROWLARR', 'QBITTORRENT', 'TMDB', 'SEERR'],
  health = async () => new Response('{}'),
}: {
  editMode?: boolean;
  services?: Array<'JELLYFIN' | 'PROWLARR' | 'QBITTORRENT' | 'TMDB' | 'SEERR'>;
  /** What /api/health answers: whether the server can be reached. */
  health?: () => Promise<Response>;
} = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    (url === '/api/health' ? health() : new Response(JSON.stringify({ services })))));
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        <WidgetAvailabilityProvider services={services}>
          <WidgetRenderer instance={instance} rowSpan={2} editMode={editMode} />
        </WidgetAvailabilityProvider>,
      ),
    );
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

    // Named by its title, not the layout's internal id.
    expect(document.body.textContent).toContain('Stats Overview failed to load');
    expect(document.body.textContent).not.toContain('stats-grid-1');
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
    sessionStorage.clear();

    // The server answers, so the chunk is gone after a deploy.
    await renderWidget();

    // A widget whose code didn't load says so as the offline cover does, and
    // reloads by itself once, as the page boundaries do.
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Stats Overview');
    expect(document.body.textContent).toContain('Can’t reach Helprr');
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(deleteCache).toHaveBeenCalledWith('pages');

    // Retry reloads too, past the automatic reload's once-a-window guard.
    await act(async () => {
      retryButton()?.click();
    });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
  });

  it('retries a widget whose code failed offline, without reloading, and again by itself when back online', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const chunkError = new Error('Loading chunk 123 failed');
    chunkError.name = 'ChunkLoadError';
    const LoadedWidget: ComponentType<WidgetProps> = () => createElement('div', null, 'Back online widget');
    mocks.getWidgetComponent
      .mockReturnValueOnce(lazy(async () => { throw chunkError; }))
      .mockReturnValueOnce(lazy(async () => { throw chunkError; }))
      .mockReturnValue(lazy(async () => ({ default: LoadedWidget })));
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    await renderWidget();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(document.body.textContent).toContain('Stats Overview');
    expect(document.body.textContent).toContain('You\'re offline');
    await act(async () => {
      retryButton()?.click();
    });
    // Offline, Retry tries the widget again and never reloads the page.
    expect(mocks.resetWidgetComponent).toHaveBeenCalledWith('stats-grid');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('You\'re offline');

    onLine.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(document.body.textContent).toContain('Back online widget');
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps the saved pages when Retry finds the server unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const chunkError = new Error('Failed to fetch dynamically imported module');
    mocks.getWidgetComponent.mockReturnValue(lazy(async () => { throw chunkError; }));
    const reload = vi.fn();
    const deleteCache = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('location', { reload });
    vi.stubGlobal('caches', { delete: deleteCache });
    sessionStorage.clear();

    const health = vi.fn(async (): Promise<Response> => { throw new TypeError('Failed to fetch'); });
    await renderWidget({ health });
    await vi.waitFor(() => expect(health).toHaveBeenCalledOnce());
    await act(async () => {
      retryButton()?.click();
    });

    await vi.waitFor(() => expect(health).toHaveBeenCalledTimes(2));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(deleteCache).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(mocks.resetWidgetComponent).toHaveBeenCalledWith('stats-grid');
  });

  it('keeps the cover\'s offline label current and stops listening once unmounted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const chunkError = new Error('Importing a module script failed.');
    mocks.getWidgetComponent.mockReturnValue(lazy(async () => { throw chunkError; }));
    const health = vi.fn(async (): Promise<Response> => { throw new TypeError('Failed to fetch'); });
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    await renderWidget({ health });
    expect(document.body.textContent).toContain('Can’t reach Helprr');

    onLine.mockReturnValue(false);
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(document.body.textContent).toContain('You\'re offline');

    await act(async () => root.unmount());
    mocks.resetWidgetComponent.mockClear();
    window.dispatchEvent(new Event('online'));
    expect(mocks.resetWidgetComponent).not.toHaveBeenCalled();
    root = createRoot(document.getElementById('root')!);
  });

  it('preserves the unknown-widget fallback', async () => {
    mocks.getWidgetDefinition.mockReturnValue(undefined);

    await renderWidget();

    expect(document.body.textContent).toContain('Unknown widget: stats-grid');
    expect(mocks.getWidgetComponent).not.toHaveBeenCalled();
  });

  it('observes a temporarily unresolved widget so it can load after hydration', async () => {
    let notify: IntersectionObserverCallback | undefined;
    const observe = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
        observe = observe;
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
        root = null;
        rootMargin = '';
        thresholds = [];
      },
    );
    const LoadedWidget: ComponentType<WidgetProps> = () =>
      createElement('div', null, 'Hydrated widget');
    mocks.getWidgetDefinition.mockReturnValue(undefined);
    mocks.getWidgetComponent.mockReturnValue(lazy(async () => ({ default: LoadedWidget })));

    await renderWidget();
    expect(observe).toHaveBeenCalledOnce();

    await act(async () => {
      notify?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      mocks.getWidgetDefinition.mockReturnValue(definition);
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          <WidgetAvailabilityProvider services={['JELLYFIN', 'PROWLARR', 'QBITTORRENT', 'TMDB', 'SEERR']}>
            <WidgetRenderer instance={instance} rowSpan={2} />
          </WidgetAvailabilityProvider>,
        ),
      );
    });

    expect(document.body.textContent).toContain('Hydrated widget');
  });

  it('does not load an offscreen widget until it enters the prefetch margin', async () => {
    let notify: IntersectionObserverCallback | undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
        observe() {}
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
        root = null;
        rootMargin = '';
        thresholds = [];
      },
    );
    const LoadedWidget: ComponentType<WidgetProps> = () =>
      createElement('div', null, 'Viewport widget');
    mocks.getWidgetComponent.mockReturnValue(lazy(async () => ({ default: LoadedWidget })));

    await renderWidget();
    expect(mocks.getWidgetComponent).not.toHaveBeenCalled();

    await act(async () => {
      notify?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(document.body.textContent).toContain('Viewport widget');

    await act(async () => {
      notify?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(document.body.textContent).toContain('Viewport widget');
  });

  it('renders offscreen widget implementations in edit mode', async () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
        root = null;
        rootMargin = '';
        thresholds = [];
      },
    );
    const LoadedWidget: ComponentType<WidgetProps> = () =>
      createElement('div', null, 'Editable widget');
    mocks.getWidgetComponent.mockReturnValue(lazy(async () => ({ default: LoadedWidget })));

    await renderWidget({ editMode: true });

    expect(document.body.textContent).toContain('Editable widget');
  });

  it('does not mount a widget whose required service is unavailable', async () => {
    mocks.getWidgetDefinition.mockReturnValue({
      ...definition,
      requiredServices: ['JELLYFIN'],
    });

    await renderWidget({ services: [] });

    expect(document.body.textContent).toContain('connect Jellyfin');
    expect(mocks.getWidgetComponent).not.toHaveBeenCalled();
  });
});
