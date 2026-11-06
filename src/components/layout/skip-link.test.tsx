// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/layout/bottom-nav', () => ({ BottomNav: () => null }));
vi.mock('@/components/notifications/push-reenable-banner', () => ({ PushReenableBanner: () => null }));
vi.mock('@/components/layout/navigation-provider', () => ({ usePendingHref: () => null }));
vi.mock('@/components/layout/navigation-loading', () => ({ NavigationLoading: () => null }));
vi.mock('@/components/browse-freshness-notice', () => ({ BrowseFreshnessNotice: () => null }));
vi.mock('@/components/layout/demo-banner', () => ({ DemoBanner: () => null }));
vi.mock('@/components/layout/route-scroll-restoration', () => ({
  RouteScrollRestoration: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/lib/query-client', () => ({ getQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/lib/store', () => ({
  useUIStore: (select: (s: Record<string, unknown>) => unknown) => select({ navPosition: 'side', watchSkin: 'default' }),
}));
import { AppShell } from './app-shell';
import { SkipLink } from './skip-link';

describe('Skip to content', () => {
  it('is the first Tab stop and moves focus past the sidebar to the page', async () => {
    const user = userEvent.setup();
    // The order the (app) layout renders: skip link, sidebar, then the shell.
    render(
      <>
        <SkipLink />
        <nav><button type="button">Dashboard</button><button type="button">Movies</button></nav>
        <AppShell><button type="button">Page action</button></AppShell>
      </>,
    );

    await user.tab();
    const link = screen.getByRole('link', { name: 'Skip to content' });
    expect(document.activeElement).toBe(link);

    await user.keyboard('{Enter}');
    const main = screen.getByRole('main');
    expect(document.activeElement).toBe(main);
    expect(window.location.hash).toBe('');

    expect(main.getAttribute('tabindex')).toBe('-1');

    // The next Tab continues inside the page, not back in the sidebar, and
    // <main> stops being focusable so a later click inside it does not take focus.
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Page action' }));
    expect(main.hasAttribute('tabindex')).toBe(false);
  });
});
