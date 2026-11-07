// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelSummary } from '@/lib/notification-channels/catalog';

const mocks = vi.hoisted(() => ({
  data: null as unknown,
  invalidate: vi.fn(async () => {}),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mocks.data, isError: false }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/ui/confirm-dialog', () => ({ ConfirmDialog: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import NotificationChannelsPage from './page';

const channel: ChannelSummary = {
  id: 'ch-1',
  type: 'webhook',
  name: 'Home Assistant',
  enabled: true,
  events: ['imported'],
  config: { headerName: 'X-Helprr-Secret' },
  secretsSet: ['url', 'headerValue'],
  destination: 'ha.local:8123',
  consecutiveFailures: 2,
  lastFailedAt: '2026-11-07T10:00:00.000Z',
  lastSucceededAt: null,
  lastError: 'HTTP 401',
  createdAt: '2026-11-01T00:00:00.000Z',
};

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ id: 'new' }), { status: 201 }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('notification channels page', () => {
  it('shows a channel by its host and failure reason, and the admin counts', () => {
    mocks.data = {
      channels: [channel],
      availableEvents: ['imported', 'securityAlert'],
      overview: { total: 3, enabled: 2, failing: 1, people: 2, byType: { webhook: 2, ntfy: 1 } },
    };
    render(<NotificationChannelsPage />);
    expect(screen.getByText('Home Assistant · Webhook')).toBeDefined();
    expect(screen.getByText('ha.local:8123')).toBeDefined();
    expect(screen.getByRole('status').textContent).toContain('Failing (2 in a row): HTTP 401');
    expect(screen.getByText("Everyone's channels")).toBeDefined();
    expect(screen.getByText('Webhook 2 · ntfy 1')).toBeDefined();
  });

  it('adds an ntfy channel with the typed secret and the chosen events', async () => {
    mocks.data = { channels: [], availableEvents: ['imported', 'grabbed'] };
    const user = userEvent.setup();
    render(<NotificationChannelsPage />);
    await user.click(screen.getByRole('button', { name: 'Add channel' }));
    await user.type(screen.getByLabelText('Name'), 'Phone');
    await user.type(screen.getByLabelText('Topic'), 'helprr-abc');
    await user.click(screen.getByRole('button', { name: /Events · 2 of 2/ }));
    await user.click(screen.getByLabelText('Download Grabbed'));
    await user.click(screen.getByRole('button', { name: 'Add channel' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/notifications/channels');
    expect(JSON.parse(String(init.body))).toEqual({
      type: 'ntfy',
      name: 'Phone',
      events: ['imported'],
      config: { serverUrl: 'https://ntfy.sh', priority: '3' },
      secrets: { topic: 'helprr-abc' },
    });
  });

  it('never fills a saved secret into the edit form, and sends none when left empty', async () => {
    mocks.data = { channels: [{ ...channel, lastError: null, consecutiveFailures: 0 }], availableEvents: ['imported'] };
    const user = userEvent.setup();
    render(<NotificationChannelsPage />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const url = screen.getByLabelText('URL') as HTMLInputElement;
    expect(url.value).toBe('');
    expect(url.placeholder).toBe('Saved. Leave empty to keep it.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(target).toBe('/api/notifications/channels/ch-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body)).secrets).toEqual({});
  });
});
