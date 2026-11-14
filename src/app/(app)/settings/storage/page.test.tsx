// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ caps: new Set<string>() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/ui/app-link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => mocks.caps.has(cap) }));
vi.mock('@/components/settings/disk-low-space-alerts', () => ({ DiskLowSpaceAlerts: () => null }));
vi.mock('@/lib/hooks/use-app-settings', () => ({
  useAppSettings: () => ({ settings: { cacheImagesEnabled: false }, loading: false, update: vi.fn() }),
}));

import StorageSettingsPage from './page';

const fetchMock = vi.fn(async () => Response.json({ total: 12, oldestAt: '2026-10-01T00:00:00.000Z' }));

function renderPage(...caps: string[]) {
  mocks.caps = new Set(caps);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><StorageSettingsPage /></QueryClientProvider>);
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

it('a member given only Storage is told why cleanup history is hidden, and it is not asked for', () => {
  renderPage('settings.storage');
  expect(screen.getByText(/Seeing cleanup history needs “View cleanup rules & history”/)).toBeTruthy();
  expect(screen.queryByText('Clear all')).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('with cleanup.view, shows the rows but not the clear actions, and says why', async () => {
  renderPage('settings.storage', 'cleanup.view');
  await waitFor(() => expect(screen.getByText('12 rows')).toBeTruthy());
  expect(screen.queryByText('Clear all')).toBeNull();
  expect(screen.getByText(/Clearing it needs “Manage cleanup rules, run cleanups & clear history”/)).toBeTruthy();
});

it('with cleanup.manage, offers the clear actions', async () => {
  renderPage('settings.storage', 'cleanup.view', 'cleanup.manage');
  await waitFor(() => expect(screen.getByText('12 rows')).toBeTruthy());
  expect(screen.getByText('Clear all')).toBeTruthy();
  expect(screen.getByText('Clear older')).toBeTruthy();
});
