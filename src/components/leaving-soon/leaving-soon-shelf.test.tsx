// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PermissionProvider, type MePayload } from '@/components/permission-provider';
import { LeavingSoonShelf } from './leaving-soon-shelf';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const MEMBER: MePayload = {
  id: 'm1', name: 'Mia', role: 'member', template: 'member', capabilities: { 'movies.view': true, 'series.view': false },
  seerrConfigured: false, tmdbConfigured: false, seerrUserId: null, jellyfinLinked: false, jellyfinConfigured: false,
  twitchConfigured: false, youtubeConfigured: false, jellyfinConnected: false, hasLocalPassword: true, customHeadersEnabled: false,
};

const item = {
  id: 'ls1', mediaType: 'movie', instanceId: 'r1', arrId: 12, title: 'Old Movie', year: 2001, posterUrl: null,
  sizeBytes: 1, markedAt: '2026-11-01T00:00:00Z', deleteAfter: new Date(Date.now() + 3.5 * 86_400_000).toISOString(),
};

function renderShelf(me: MePayload, type?: 'movie' | 'series') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PermissionProvider value={me}><LeavingSoonShelf type={type} /></PermissionProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('LeavingSoonShelf', () => {
  it('shows the countdown and keeps a title', async () => {
    const fetchMock = vi.fn(async (url: string) => (url.includes('/keep')
      ? new Response(JSON.stringify({ ok: true }))
      : new Response(JSON.stringify({ items: [item] }))));
    vi.stubGlobal('fetch', fetchMock);
    renderShelf(MEMBER, 'movie');
    expect(await screen.findByText('Old Movie')).toBeTruthy();
    expect(screen.getByText('Leaves in 4 days')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Old Movie/ }).getAttribute('href')).toBe('/movies/12?instance=r1');
    await userEvent.click(screen.getByRole('button', { name: 'Keep Old Movie' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/leaving-soon/ls1/keep', { method: 'POST' }));
  });

  it('renders nothing when no title is leaving', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [] })));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderShelf(MEMBER, 'movie');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
  });

  it('does not even ask for a library the member cannot view', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderShelf(MEMBER, 'series');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });
});
