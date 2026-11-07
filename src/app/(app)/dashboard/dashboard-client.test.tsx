// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const refresh = vi.fn();
  // Stable, as the app's router is: a new object per render would re-run the effect.
  return {
    isMobile: false, editMode: false, refresh, router: { refresh },
    canCustomize: true, setEditMode: vi.fn(),
    widgetFetch: vi.fn(async () => 1),
    pullToRefresh: null as null | { onRefresh: () => unknown; disabled?: boolean },
  };
});
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => mocks.router }));
// One real widget data consumer, so a refresh is seen to reach the widgets.
vi.mock('@/components/widgets/widget-grid', async () => {
  const { useWidgetData } = await import('@/lib/widgets/use-widget-data');
  return {
    WidgetGrid: () => {
      useWidgetData({ fetchFn: mocks.widgetFetch, refreshInterval: 60_000, cacheKey: 'probe' });
      return <div data-testid="grid" />;
    },
  };
});
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/components/widgets/bento-primitives', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/widgets/bento-primitives')>()),
  BentoTopBar: () => null,
}));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => cap === 'dashboard.customize' && mocks.canCustomize }));
vi.mock('@/components/widgets/dashboard-layout-context', () => ({
  DashboardLayoutProvider: ({ children }: { children: React.ReactNode }) => children,
  useDashboardLayout: () => ({ widgets: [], isDirty: false, setWidgets: vi.fn() }),
}));
vi.mock('@/lib/widgets/widget-availability-context', () => ({ WidgetAvailabilityProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/widgets/layout-switcher', () => ({ LayoutSwitcher: () => null }));
vi.mock('@/lib/store', () => ({ useUIStore: (select: (s: Record<string, unknown>) => unknown) => select({ dashboardEditMode: mocks.editMode, setDashboardEditMode: mocks.setEditMode }) }));
vi.mock('@/components/ui/pull-to-refresh', () => ({
  PullToRefresh: (props: { onRefresh: () => unknown; disabled?: boolean }) => {
    mocks.pullToRefresh = props;
    return null;
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DashboardClient } from './dashboard-client';

const LAYOUT = { id: 'layout-1', name: 'Home', widgets: [], isBuiltIn: true };
let root: Root;
const client = new QueryClient();
const page = (initialDevice: 'desktop' | 'mobile') => (
  <QueryClientProvider client={client}>
    <DashboardClient initialLayout={LAYOUT} initialDevice={initialDevice} configuredServices={[]} />
  </QueryClientProvider>
);
const render = (initialDevice: 'desktop' | 'mobile') => act(() => root.render(page(initialDevice)));
const showsGrid = () => document.querySelector('[data-testid="grid"]') !== null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.refresh.mockClear();
  mocks.editMode = false;
  mocks.canCustomize = true;
  mocks.setEditMode.mockClear();
  // The real useIsMobile reads this; one object, as the hook caches it.
  const query = { get matches() { return mocks.isMobile; }, addEventListener() {}, removeEventListener() {} };
  vi.stubGlobal('matchMedia', () => query);
  sessionStorage.clear();
  document.cookie = 'helprr-device=; Path=/; Max-Age=0';
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
});

// Kept suppression (audit-w8 Batch B): the effect clears the reload spinner once
// the server has rendered for the device the browser detects.
describe('DashboardClient device sync', () => {
  it('shows the spinner and refreshes when the server rendered for the other device, then clears it once they match', () => {
    mocks.isMobile = true;
    render('desktop');
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(showsGrid()).toBe(false);
    expect(document.cookie).toContain('helprr-device=mobile');

    // The refresh re-renders the page for the detected device.
    render('mobile');
    expect(showsGrid()).toBe(true);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh a phone page the server rendered for the phone, on the hydration pass', () => {
    // The hydration pass sees useIsMobile's server snapshot (desktop).
    mocks.isMobile = true;
    act(() => root.unmount());
    const container = document.getElementById('root')!;
    container.innerHTML = renderToString(page('mobile'));
    const hydrationErrors: unknown[] = [];
    act(() => {
      root = hydrateRoot(container, page('mobile'), { onRecoverableError: (error) => hydrationErrors.push(error) });
    });
    // A failed hydration would client-render and skip the pass under test.
    expect(hydrationErrors).toEqual([]);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(showsGrid()).toBe(true);
    expect(document.cookie).toContain('helprr-device=mobile');
  });

  it('keeps the spinner up while the hydration pass refresh is on its way', () => {
    mocks.isMobile = true;
    act(() => root.unmount());
    const container = document.getElementById('root')!;
    container.innerHTML = renderToString(page('desktop'));
    act(() => {
      root = hydrateRoot(container, page('desktop'));
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(showsGrid()).toBe(false);

    act(() => root.render(page('mobile')));
    expect(showsGrid()).toBe(true);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh while offline: the failed fetch would reload the whole page', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mocks.isMobile = true;
    render('desktop');
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(showsGrid()).toBe(true);
  });

  it('does not refresh again for the same device on the next page load', () => {
    mocks.isMobile = true;
    render('desktop');
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    // A fresh document: the component state is gone, sessionStorage is not.
    act(() => root.unmount());
    root = createRoot(document.getElementById('root')!);
    render('desktop');
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(showsGrid()).toBe(true);
  });

  it('renders straight away when the devices already match', () => {
    mocks.isMobile = false;
    render('desktop');
    expect(showsGrid()).toBe(true);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe('DashboardClient heading', () => {
  it('keeps the page title for screen readers only, as on every top-level page', () => {
    mocks.isMobile = false;
    render('desktop');
    const headings = document.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe('Dashboard');
    expect(headings[0].className).toContain('sr-only');
  });
});

describe('DashboardClient pull to refresh', () => {
  it('refetches the widget queries, not the whole page', async () => {
    mocks.isMobile = true;
    render('mobile');
    await vi.waitFor(() => expect(client.isFetching()).toBe(0));
    const before = mocks.widgetFetch.mock.calls.length;
    await act(async () => { await mocks.pullToRefresh!.onRefresh(); });
    expect(mocks.widgetFetch).toHaveBeenCalledTimes(before + 1);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.pullToRefresh!.disabled).toBe(false);
  });

  it('is off while editing, where touches drag widgets', () => {
    mocks.isMobile = true;
    mocks.editMode = true;
    render('mobile');
    expect(mocks.pullToRefresh!.disabled).toBe(true);
  });
});

describe('DashboardClient Edit row', () => {
  const editButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Edit dashboard"]');

  it.each(['desktop', 'mobile'] as const)('puts a small inline Edit above the widgets on %s, with no heading text', (device) => {
    mocks.isMobile = device === 'mobile';
    render(device);
    const button = editButton()!;
    expect(button.textContent).toBe('Edit');
    const row = button.parentElement!;
    // Inline, right-aligned, 40px, and ahead of the widgets: not floating over them.
    expect(row.style.height).toBe('40px');
    expect(row.style.justifyContent).toBe('flex-end');
    expect(row.textContent).toBe('Edit');
    expect(button.style.position).toBe('');
    expect(row.compareDocumentPosition(document.querySelector('[data-testid="grid"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelectorAll('h1, h2, h3')).toHaveLength(1);

    act(() => button.click());
    expect(mocks.setEditMode).toHaveBeenCalledWith(true);
  });

  it('is not shown to someone who cannot customize the layout', () => {
    mocks.isMobile = false;
    mocks.canCustomize = false;
    render('desktop');
    expect(editButton()).toBeNull();
    expect(showsGrid()).toBe(true);
  });

  it('gives way to the editing bar while editing', () => {
    mocks.isMobile = false;
    mocks.editMode = true;
    render('desktop');
    expect(editButton()).toBeNull();
  });
});
