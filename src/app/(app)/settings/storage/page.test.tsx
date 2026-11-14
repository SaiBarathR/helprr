// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/ui/app-link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/settings/disk-low-space-alerts', () => ({ DiskLowSpaceAlerts: () => null }));
vi.mock('@/lib/hooks/use-app-settings', () => ({
  useAppSettings: () => ({ settings: { cacheImagesEnabled: false }, loading: false, update: vi.fn() }),
}));

import StorageSettingsPage from './page';

const fetchMock = vi.fn(async () => Response.json({ total: 12, oldestAt: '2026-10-01T00:00:00.000Z' }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><StorageSettingsPage /></QueryClientProvider>);
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

it('a member given only Storage sees cleanup history and may clear it', async () => {
  // The summary and Clear older / Clear all come with this page (the server
  // takes settings.storage for exactly those); the rows stay cleanup.view.
  renderPage();
  await waitFor(() => expect(screen.getByText('12 rows')).toBeTruthy());
  expect(fetchMock).toHaveBeenCalledWith('/api/cleanup/history?summary=true', expect.anything());
  expect(screen.getByText('Clear all')).toBeTruthy();
  expect(screen.getByText('Clear older')).toBeTruthy();
  expect(screen.queryByText(/needs “/)).toBeNull();
});
