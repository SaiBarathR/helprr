// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/ui/app-link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/settings/disk-low-space-alerts', () => ({ DiskLowSpaceAlerts: () => null }));
vi.mock('@/lib/hooks/use-app-settings', () => ({
  useAppSettings: () => ({ settings: { cacheImagesEnabled: false }, loading: false, update: vi.fn() }),
}));

import StorageSettingsPage from './page';

const summary = async () => Response.json({ total: 12, oldestAt: '2026-10-01T00:00:00.000Z' });
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(summary);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><StorageSettingsPage /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockImplementation(summary);
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

describe('Clear all confirm', () => {
  async function openClearAll() {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('12 rows')).toBeTruthy());
    await user.click(screen.getByText('Clear all'));
    await user.click(await screen.findByRole('button', { name: 'Yes, delete all' }));
  }

  it('closes once the rows are deleted, with the success toast', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (
      init?.method === 'DELETE' ? Response.json({ deleted: 12 }) : Response.json({ total: 12, oldestAt: '2026-10-01T00:00:00.000Z' })
    ));
    await openClearAll();

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Deleted 12 rows');
  });

  it('stays open beside the error when the delete fails', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (
      init?.method === 'DELETE'
        ? Response.json({ error: 'Database unavailable' }, { status: 503 })
        : Response.json({ total: 12, oldestAt: '2026-10-01T00:00:00.000Z' })
    ));
    await openClearAll();

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Database unavailable'));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Yes, delete all' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
