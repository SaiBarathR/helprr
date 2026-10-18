// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const refresh = vi.fn();
  // Stable, as the app's router is: a new object per render would re-run the effect.
  return { isMobile: false, refresh, router: { refresh } };
});
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => mocks.router }));
vi.mock('@/hooks/use-is-mobile', () => ({ useIsMobile: () => mocks.isMobile }));
vi.mock('@/components/widgets/widget-grid', () => ({ WidgetGrid: () => <div data-testid="grid" /> }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/components/widgets/bento-primitives', () => ({ BentoTopBar: () => null, FloatingEdit: () => null, HPR: { ink: '#000', hairline2: '#111', amber: '#f90' } }));
vi.mock('@/components/widgets/dashboard-layout-context', () => ({
  DashboardLayoutProvider: ({ children }: { children: React.ReactNode }) => children,
  useDashboardLayout: () => ({ widgets: [], isDirty: false, setWidgets: vi.fn() }),
}));
vi.mock('@/lib/widgets/widget-availability-context', () => ({ WidgetAvailabilityProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/widgets/layout-switcher', () => ({ LayoutSwitcher: () => null }));
vi.mock('@/lib/store', () => ({ useUIStore: (select: (s: Record<string, unknown>) => unknown) => select({ dashboardEditMode: false, setDashboardEditMode: () => {} }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DashboardClient } from './dashboard-client';

const LAYOUT = { id: 'layout-1', name: 'Home', widgets: [], isBuiltIn: true };
let root: Root;
const client = new QueryClient();
const render = (initialDevice: 'desktop' | 'mobile') => act(() => root.render(
  <QueryClientProvider client={client}>
    <DashboardClient initialLayout={LAYOUT} initialDevice={initialDevice} configuredServices={[]} />
  </QueryClientProvider>,
));
const showsGrid = () => document.querySelector('[data-testid="grid"]') !== null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.refresh.mockClear();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(() => act(() => root.unmount()));

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

  it('renders straight away when the devices already match', () => {
    mocks.isMobile = false;
    render('desktop');
    expect(showsGrid()).toBe(true);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
