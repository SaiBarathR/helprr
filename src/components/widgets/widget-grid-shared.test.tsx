// @vitest-environment jsdom

import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextActionGroup } from '@/components/ui/quick-context-menu';

const mocks = vi.hoisted(() => ({ canCustomize: true, preload: vi.fn() }));

vi.mock('@/components/permission-provider', () => ({
  useMe: () => null,
  hasCapabilities: () => true,
  useCan: (cap: string) => cap === 'dashboard.customize' && mocks.canCustomize,
}));
vi.mock('@/lib/widgets/registry', () => ({
  getWidgetDefinition: (id: string) => (id === 'requests-list' ? { name: 'Requests', requiredServices: ['SEERR'] } : { name: 'Stats' }),
}));
vi.mock('./bento-cell', () => ({
  BentoCell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BentoEditChrome: () => null,
}));
vi.mock('./widget-renderer', () => ({ WidgetRenderer: () => null }));
vi.mock('./widget-loaders', () => ({ preloadWidgetCode: mocks.preload }));
// The long-press menu itself is covered elsewhere: list the actions it would offer, after
// its own normalisation (which drops empty groups).
vi.mock('@/components/ui/quick-context-menu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/quick-context-menu')>();
  return {
    ...actual,
    QuickContextMenu: ({ groups, children }: { groups: ContextActionGroup[]; children: React.ReactNode }) => (
      <div>
        {actual.normalizeContextActionGroups(groups).map((group) => (
          <div key={group.id} data-group={group.id}>
            {group.actions.map((action) => (
              <button key={action.id} type="button" onClick={() => action.onSelect?.()}>{action.label}</button>
            ))}
          </div>
        ))}
        {children}
      </div>
    ),
  };
});

import { useVisibleDashboardWidgets, WidgetGridItem } from './widget-grid-shared';
import { useUIStore } from '@/lib/store';

const INSTANCE = { id: 'w1', widgetId: 'stats-grid', colSpan: 1, rowSpan: 1 } as never;
const onRemove = vi.fn();
const renderItem = () => render(
  <WidgetGridItem instance={INSTANCE} editMode={false} onRemove={onRemove} onConfigureRefresh={() => {}} />,
);
const labels = () => screen.queryAllByRole('button').map((button) => button.textContent);

beforeEach(() => {
  mocks.canCustomize = true;
  onRemove.mockClear();
  useUIStore.setState({ dashboardEditMode: false });
});

describe('WidgetGridItem long-press actions', () => {
  it('offers Customize and Remove to someone who can customize the layout', async () => {
    renderItem();
    expect(labels()).toEqual(['Customize dashboard', 'Configure refresh intervals', 'Remove widget']);
    await userEvent.click(screen.getByRole('button', { name: 'Remove widget' }));
    expect(useUIStore.getState().dashboardEditMode).toBe(true);
    expect(onRemove).toHaveBeenCalledWith('w1');
  });

  it('leaves Customize and Remove out without dashboard.customize, so nothing opens edit mode', () => {
    mocks.canCustomize = false;
    renderItem();
    expect(labels()).toEqual(['Configure refresh intervals']);
    expect(document.querySelector('[data-group="danger"]')).toBeNull();
    expect(useUIStore.getState().dashboardEditMode).toBe(false);
  });
});

describe('useVisibleDashboardWidgets', () => {
  const layout = [
    { id: 'a', widgetId: 'stats-grid', colSpan: 1, rowSpan: 1 },
    { id: 'b', widgetId: 'stats-grid', colSpan: 1, rowSpan: 1 },
    { id: 'c', widgetId: 'torrent-overview', colSpan: 1, rowSpan: 1 },
  ] as never;
  let idle: (() => void) | undefined;

  beforeEach(() => {
    mocks.preload.mockClear();
    idle = undefined;
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => { idle = callback; return 1; });
    vi.stubGlobal('cancelIdleCallback', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches every visible widget's code once the page is idle, so it is there offline", () => {
    renderHook(() => useVisibleDashboardWidgets(layout));
    expect(mocks.preload).not.toHaveBeenCalled();
    idle?.();
    expect(mocks.preload.mock.calls.map(([id]) => id)).toEqual(['stats-grid', 'torrent-overview']);
  });

  it('skips a widget whose service is not connected, since it never loads its code', () => {
    const withRequests = [...(layout as unknown as unknown[]), { id: 'd', widgetId: 'requests-list', colSpan: 1, rowSpan: 1 }] as never;
    renderHook(() => useVisibleDashboardWidgets(withRequests));
    idle?.();
    expect(mocks.preload.mock.calls.map(([id]) => id)).toEqual(['stats-grid', 'torrent-overview']);
  });

  it('waits for the network when it starts offline, and fetches again each time it returns', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderHook(() => useVisibleDashboardWidgets(layout));
    expect(idle).toBeUndefined();
    expect(mocks.preload).not.toHaveBeenCalled();

    onLine.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    idle?.();
    expect(mocks.preload).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('online'));
    idle?.();
    expect(mocks.preload).toHaveBeenCalledTimes(4);
  });

  it('uses a timer where there is no requestIdleCallback (Safari), and cancels it on unmount', () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('requestIdleCallback', undefined);
      const first = renderHook(() => useVisibleDashboardWidgets(layout));
      vi.advanceTimersByTime(2_000);
      expect(mocks.preload).toHaveBeenCalledTimes(2);
      first.unmount();

      mocks.preload.mockClear();
      const second = renderHook(() => useVisibleDashboardWidgets(layout));
      second.unmount();
      vi.advanceTimersByTime(2_000);
      window.dispatchEvent(new Event('online'));
      vi.advanceTimersByTime(2_000);
      expect(mocks.preload).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
