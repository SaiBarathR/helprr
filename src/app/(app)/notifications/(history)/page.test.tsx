// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/components/permission-provider', () => ({
  useMe: () => ({ id: 'u1', role: 'member', capabilities: {} }),
  hasCapability: () => true,
}));
vi.mock('@/components/layout/badge-provider', () => ({
  useBadgeActions: () => ({ adjustBadge: vi.fn(), setBadge: vi.fn(), refreshBadges: vi.fn() }),
}));
vi.mock('@/components/ui/pull-to-refresh', () => ({ PullToRefresh: () => null }));

import { useUIStore } from '@/lib/store';
import NotificationsPage from './page';

const page = (records: unknown[]) => Response.json({ records, totalRecords: records.length });
const fetchMock = vi.fn();

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><NotificationsPage /></QueryClientProvider>);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  useUIStore.setState({ hasHydrated: true });
});
afterEach(() => vi.unstubAllGlobals());

// The event-types lookup answers; only the list itself is under test.
function serveList(list: () => Promise<Response>) {
  fetchMock.mockImplementation((url: string) => (
    url.startsWith('/api/notifications?') ? list() : Promise.resolve(Response.json({ eventTypes: [] }))
  ));
}

describe('Notifications list that could not load', () => {
  it('says the device is offline, not that there are no notifications', async () => {
    serveList(() => Promise.reject(new TypeError('Failed to fetch')));
    renderPage();

    expect(await screen.findByText("You're offline")).toBeTruthy();
    expect(screen.queryByText('No notifications yet')).toBeNull();
  });

  it('offers Retry after a server error, and shows the list once it answers', async () => {
    serveList(() => Promise.resolve(Response.json({ error: 'boom' }, { status: 503 })));
    renderPage();

    expect(await screen.findByText("Couldn't load notifications")).toBeTruthy();
    expect(screen.queryByText('No notifications yet')).toBeNull();

    serveList(() => Promise.resolve(page([])));
    await userEvent.setup().click(screen.getByRole('button', { name: /Retry/ }));
    await waitFor(() => expect(screen.getByText('No notifications yet')).toBeTruthy());
  });

  it('has no Retry for a refusal, which asking again will not change', async () => {
    serveList(() => Promise.resolve(Response.json({ error: 'Forbidden' }, { status: 403 })));
    renderPage();

    expect(await screen.findByText("Couldn't load notifications")).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
  });

  it('still says there are none when the list loads empty', async () => {
    serveList(() => Promise.resolve(page([])));
    renderPage();
    expect(await screen.findByText('No notifications yet')).toBeTruthy();
  });
});
