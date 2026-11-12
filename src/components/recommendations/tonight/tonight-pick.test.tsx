// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TonightTitle, TonightView } from '@/types/tonight';
import { TONIGHT_LAST_KEY, TONIGHT_POLL_MS, TonightPick } from './tonight-pick';

vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/hooks/use-external-urls', () => ({ useExternalUrls: () => ({ JELLYFIN: 'https://jf.example' }) }));
vi.mock('@/components/permission-provider', () => ({
  useMe: () => ({ id: 'mum', jellyfinConnected: true, capabilities: { 'jellyfin.view': true } }),
  hasCapability: (me: { capabilities: Record<string, boolean> } | null, cap: string) => me?.capabilities[cap] === true,
}));

const ID = 'AbCdEfGhIjKlMnOpQrStUv';

const title = (i: number): TonightTitle => ({
  mediaType: 'movie', id: i, instanceId: 'r1', title: `Film ${i}`, year: 2001, overview: null,
  posterUrl: null, backdropUrl: null, runtime: 90, genres: [], href: `/movies/${i}?instance=r1`,
  rating: null, imdbId: `tt${i}`, tmdbId: i, tvdbId: null,
});

function view(extra: Partial<TonightView> = {}): TonightView {
  return {
    id: ID, status: 'open', isStarter: false, starterName: 'Sai',
    filters: { type: 'movie', watch: 'all' }, narrowed: false,
    titles: [title(0), title(1)], myVotes: {},
    participants: [
      { id: 'sai', name: 'Sai', isStarter: true, joined: true, voted: 2 },
      { id: 'mum', name: 'Mum', isStarter: false, joined: true, voted: 0 },
    ],
    winnerIndex: null, nearMisses: [], expiresAt: '2099-01-01T00:00:00.000Z',
    ...extra,
  };
}

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderPick() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TonightPick id={ID} onClose={vi.fn()} onOpenPick={vi.fn()} />
    </QueryClientProvider>,
  );
}

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TonightPick', () => {
  it('hydrates a pick opened from a link without a mismatch, and focuses the dialog', async () => {
    fetchMock.mockImplementation(async () => respond(200, view()));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const pick = (
      <QueryClientProvider client={client}>
        <TonightPick id={ID} onClose={vi.fn()} onOpenPick={vi.fn()} />
      </QueryClientProvider>
    );
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToString(pick);
    const recoverable = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => { root = hydrateRoot(container, pick, { onRecoverableError: recoverable }); });

    const dialog = await screen.findByRole('dialog', { name: 'Tonight pick' });
    expect(recoverable).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(dialog);
    act(() => root?.unmount());
    container.remove();
  });

  it('joins on open, records a vote, and shows the winner with Play and Open in Jellyfin', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      if (input === `/api/tonight/${ID}/join`) return respond(200, view());
      if (input === `/api/tonight/${ID}/vote`) {
        expect(JSON.parse(String(init?.body))).toEqual({ index: 0, yes: true });
        return respond(200, view({ status: 'matched', winnerIndex: 0, myVotes: { 0: true } }));
      }
      if (input.startsWith('/api/jellyfin/lookup?')) return respond(200, { itemId: 'jf-item-0' });
      return respond(200, view());
    });
    const user = userEvent.setup();
    renderPick();

    await user.click(await screen.findByRole('button', { name: 'Yes, watch Film 0' }));
    expect(await screen.findByText('Everyone said yes')).toBeTruthy();
    expect((await screen.findByRole('link', { name: /Play/ })).getAttribute('href')).toBe('/jellyfin/library/watch/jf-item-0');
    expect(screen.getByRole('link', { name: /Open in Jellyfin/ }).getAttribute('href'))
      .toBe('https://jf.example/web/index.html#!/details?id=jf-item-0');
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/tonight/${ID}/join`);
  });

  it('remembers an open pick for "Back to pick" and forgets it once it is decided', async () => {
    fetchMock.mockImplementation(async (input) => {
      if (input === `/api/tonight/${ID}/vote`) return respond(200, view({ status: 'matched', winnerIndex: 0, myVotes: { 0: true } }));
      if (input.startsWith('/api/jellyfin/lookup?')) return respond(200, { itemId: null });
      return respond(200, view());
    });
    const user = userEvent.setup();
    renderPick();
    await screen.findByRole('button', { name: 'Yes, watch Film 0' });
    await waitFor(() => expect(JSON.parse(localStorage.getItem(TONIGHT_LAST_KEY)!)).toMatchObject({ id: ID }));
    await user.click(screen.getByRole('button', { name: 'Yes, watch Film 0' }));
    await screen.findByText('Everyone said yes');
    await waitFor(() => expect(localStorage.getItem(TONIGHT_LAST_KEY)).toBeNull());
  });

  it('stops showing a live pick once a poll finds it gone', async () => {
    let gone = false;
    fetchMock.mockImplementation(async () => (gone ? respond(404, { error: 'Not found' }) : respond(200, view())));
    renderPick();
    await screen.findByRole('button', { name: 'Yes, watch Film 0' });
    gone = true;
    expect(await screen.findByText('This pick isn’t available', {}, { timeout: TONIGHT_POLL_MS + 2_000 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Yes, watch Film 0' })).toBeNull();
    const calls = fetchMock.mock.calls.length;
    await new Promise((r) => setTimeout(r, TONIGHT_POLL_MS + 300));
    expect(fetchMock.mock.calls.length).toBe(calls);
  }, 10_000);

  it('tells someone without access that the pick is not available', async () => {
    fetchMock.mockResolvedValue(respond(404, { error: 'Not found' }));
    renderPick();
    expect(await screen.findByText('This pick isn’t available')).toBeTruthy();
  });

  it('shows the no-match state with the closest titles', async () => {
    fetchMock.mockResolvedValue(respond(200, view({ status: 'noMatch', nearMisses: [{ index: 1, yes: 1 }] })));
    renderPick();
    expect(await screen.findByText('No match tonight')).toBeTruthy();
    expect(screen.getByText('1 of 2 yes')).toBeTruthy();
    expect(screen.getByText('Ask Sai to start another round.')).toBeTruthy();
  });

  it('waits for the others once you have voted on everything', async () => {
    fetchMock.mockResolvedValue(respond(200, view({
      myVotes: { 0: false, 1: true },
      participants: [
        { id: 'sai', name: 'Sai', isStarter: true, joined: true, voted: 1 },
        { id: 'mum', name: 'Mum', isStarter: false, joined: true, voted: 2 },
      ],
    })));
    renderPick();
    expect(await screen.findByText('You’re done')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Waiting for Sai.')).toBeTruthy());
  });
});
