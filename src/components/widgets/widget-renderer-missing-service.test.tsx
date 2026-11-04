// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ canConnect: true }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => mocks.canConnect }));
vi.mock('@/lib/widgets/widget-availability-context', () => ({ useConfiguredWidgetServices: () => new Set() }));
vi.mock('@/lib/hooks/use-near-viewport', () => ({ useNearViewport: () => ({ ref: { current: null }, isNearViewport: false, hasEnteredViewport: false }) }));
vi.mock('@/lib/store', () => ({ useUIStore: () => 'default' }));
vi.mock('@/lib/widgets/registry', () => ({
  getWidgetDefinition: () => ({ id: 'torrents', requiredServices: ['QBITTORRENT'], defaultRefreshIntervalSecs: 30 }),
}));
vi.mock('./widget-loaders', () => ({ getWidgetComponent: () => null, resetWidgetComponent: vi.fn() }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }));

import { WidgetRenderer } from './widget-renderer';

const instance = { id: 'w1', widgetId: 'torrents' } as Parameters<typeof WidgetRenderer>[0]['instance'];

beforeEach(() => {
  mocks.canConnect = true;
});

describe('a widget whose service is not connected', () => {
  it('leads an admin to the connection it needs', () => {
    render(<WidgetRenderer instance={instance} />);
    const link = screen.getByRole('link', { name: /^Connect qBittorrent/ });
    expect(link.getAttribute('href')).toBe('/settings/instances/qbittorrent');
  });

  it('is not a link while the dashboard is being edited', () => {
    render(<WidgetRenderer instance={instance} editMode />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Connect qBittorrent')).toBeDefined();
  });

  it('tells a member who can fix it', () => {
    mocks.canConnect = false;
    render(<WidgetRenderer instance={instance} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Ask your admin to connect qBittorrent')).toBeDefined();
  });
});

describe('the menu of an empty widget', () => {
  it('still opens on a long press of the link that fills it', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const { QuickContextMenu } = await import('@/components/ui/quick-context-menu');
    const { act, fireEvent } = await import('@testing-library/react');
    render(
      <QuickContextMenu label="Widget actions" actions={[{ id: 'customize', label: 'Customize dashboard', onSelect: () => {} }, { id: 'remove', label: 'Remove widget', onSelect: () => {} }]}>
        <div><WidgetRenderer instance={instance} /></div>
      </QuickContextMenu>,
    );
    fireEvent.pointerDown(screen.getByRole('link'), { pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0, clientX: 10, clientY: 10 });
    act(() => { vi.advanceTimersByTime(800); });
    expect(screen.queryByRole('menu', { name: 'Widget actions' })).not.toBeNull();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
