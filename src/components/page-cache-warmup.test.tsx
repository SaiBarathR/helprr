// @vitest-environment jsdom

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/calendar' }));
const ui = vi.hoisted(() => ({ hasHydrated: true, defaultPage: 'calendar', navOrder: [] as string[], disabledNavItems: [] as string[] }));
const warmPageCache = vi.hoisted(() => vi.fn());
const sessionEnd = vi.hoisted(() => ({ listeners: new Set<() => void>() }));

vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('@/lib/store', () => ({
  useUIStore: (select: (s: typeof ui) => unknown) => select(ui),
}));
vi.mock('@/lib/nav-config', () => ({
  resolveDefaultPageHref: ({ defaultPage }: { defaultPage: string }) => `/${defaultPage}`,
}));
vi.mock('@/lib/page-warmup', () => ({ warmPageCache }));
vi.mock('@/lib/client-cache', () => ({
  subscribeToSessionEnd: (listener: () => void) => {
    sessionEnd.listeners.add(listener);
    return () => { sessionEnd.listeners.delete(listener); };
  },
}));

import { PageCacheWarmup } from './page-cache-warmup';

describe('PageCacheWarmup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    warmPageCache.mockClear();
    sessionEnd.listeners.clear();
    nav.pathname = '/calendar';
    ui.hasHydrated = true;
    window.history.replaceState(null, '', '/calendar?view=week');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the start URL, the default page and the opened page, after a short delay', () => {
    render(<PageCacheWarmup />);
    expect(warmPageCache).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(warmPageCache.mock.calls.map(([href]) => href).sort()).toEqual(['/', '/calendar', '/calendar?view=week']);
  });

  it('keeps each page reached by in-app navigation, even one left quickly', () => {
    const { rerender } = render(<PageCacheWarmup />);
    window.history.pushState(null, '', '/movies');
    nav.pathname = '/movies';
    rerender(<PageCacheWarmup />);
    window.history.pushState(null, '', '/series');
    nav.pathname = '/series';
    rerender(<PageCacheWarmup />);
    act(() => { vi.advanceTimersByTime(1_000); });
    const hrefs = warmPageCache.mock.calls.map(([href]) => href);
    expect(hrefs).toEqual(expect.arrayContaining(['/calendar?view=week', '/movies', '/series']));
  });

  it('waits for the saved preferences before resolving the default page', () => {
    ui.hasHydrated = false;
    render(<PageCacheWarmup />);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(warmPageCache.mock.calls.map(([href]) => href)).toEqual(['/calendar?view=week']);
  });

  it('cancels pending warm-ups when the app shell unmounts', () => {
    const { unmount } = render(<PageCacheWarmup />);
    unmount();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(warmPageCache).not.toHaveBeenCalled();
    expect(sessionEnd.listeners.size).toBe(0);
  });

  it('cancels pending warm-ups and schedules none once the session ends', () => {
    const { rerender } = render(<PageCacheWarmup />);
    act(() => { for (const listener of sessionEnd.listeners) listener(); });
    window.history.pushState(null, '', '/movies');
    nav.pathname = '/movies';
    rerender(<PageCacheWarmup />);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(warmPageCache).not.toHaveBeenCalled();
  });
});
