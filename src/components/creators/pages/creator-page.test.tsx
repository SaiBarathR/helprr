// @vitest-environment jsdom
import { Suspense, useState, type ComponentProps, type ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canManage: true,
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/components/permission-provider', () => ({
  useMe: () => ({}),
  hasCapability: () => mocks.canManage,
}));
vi.mock('@/components/layout/page-header', () => ({
  PageHeader: ({ rightContent }: { rightContent?: ReactNode }) => <header>{rightContent}</header>,
}));
vi.mock('@/components/ui/app-link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));
vi.mock('@/components/ui/pull-to-refresh', () => ({ PullToRefresh: () => null }));
vi.mock('@/lib/hooks/use-route-view-state', () => ({ useRouteViewState: <T,>(_name: string, initial: T) => useState(initial) }));
vi.mock('@/components/creators/use-feed-view', () => ({ useFeedLayout: () => 'list' }));
vi.mock('@/components/creators/use-video-actions', () => ({ useVideoActions: () => ({ sheet: null }) }));
vi.mock('@/components/creators/use-video-selection', () => ({
  useVideoSelection: () => ({ canSelect: false, active: false, bar: null, selectionFor: () => undefined, startWith: () => undefined }),
}));
vi.mock('@/lib/hooks/use-restorable-infinite-query', () => ({
  useRestorableInfiniteQuery: () => ({ isLoading: false, isError: false, data: { pages: [] }, hasNextPage: false }),
}));

import { CreatorPlatformProvider } from '@/components/creators/platform';
import { CreatorPage } from './creator-page';

const channel = (extra: Record<string, unknown> = {}) => ({
  id: 'c1', login: 'trashtaste', displayName: 'Trash Taste', description: null, profileImageUrl: null, offlineImageUrl: null,
  isLive: false, liveTitle: null, subscription: { id: 's1', notifyNewVods: true }, videoCounts: { UPLOAD: 1 }, ...extra,
});

function respond(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    if (!(key in routes)) throw new Error(`Unexpected ${key}`);
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderPage(platform: 'youtube' | 'twitch' = 'youtube') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <CreatorPlatformProvider platform={platform}>
          <Suspense fallback={null}><CreatorPage params={Promise.resolve({ id: 'c1' })} /></Suspense>
        </CreatorPlatformProvider>
      </QueryClientProvider>,
    );
  });
  await screen.findByText('Trash Taste');
}

/** Through the page's menu; says whether the menu offered the rules. */
async function unfollow(label = 'Unfollow') {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Trash Taste actions' }));
  const item = await screen.findByRole('menuitem', { name: label });
  const rules = screen.queryByRole('menuitem', { name: 'Download rules' }) !== null;
  await user.click(item);
  return { rules };
}

describe('leaving a channel others still follow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canManage = true;
  });

  it('shows whoever sets the rules how many people follow', async () => {
    respond({ 'GET /api/youtube/channels/c1': channel({ followers: 3 }) });
    await renderPage();
    expect(screen.getByText(/Followed by 3 people/)).toBeTruthy();
  });

  it('says new videos can still download, and offers an admin a way to turn that off', async () => {
    const fetchMock = respond({
      'GET /api/youtube/channels/c1': channel({ followers: 3 }),
      'DELETE /api/youtube/subscriptions/s1': { ok: true, othersFollowing: 2, autoDownload: true },
      'GET /api/youtube/policies?channelId=c1': {
        channel: { policy: { autoDownload: true, quality: '720p' }, typePolicies: { SHORT: { autoDownload: true }, ARCHIVE: { quality: '1080p' } } },
      },
      'PUT /api/youtube/policies': { ok: true },
    });
    await renderPage();
    expect((await unfollow()).rules).toBe(true);

    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    const [message, options] = mocks.toast.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(message).toBe('Unfollowed. 2 other people still follow Trash Taste, so new videos can still download.');
    expect(options.action.label).toBe('Turn off auto-download');

    options.action.onClick();
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Auto-download is off for Trash Taste'));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(put[1]!.body as string)).toEqual({
      channelId: 'c1',
      policy: { autoDownload: false, quality: '720p' },
      typePolicies: { SHORT: { autoDownload: false }, ARCHIVE: { quality: '1080p' } },
    });
  });

  it('tells a member who else follows, with no rule controls', async () => {
    mocks.canManage = false;
    respond({
      'GET /api/youtube/channels/c1': channel(),
      'DELETE /api/youtube/subscriptions/s1': { ok: true, othersFollowing: 1 },
    });
    await renderPage();
    expect(screen.queryByText(/Followed by/)).toBeNull();
    expect((await unfollow()).rules).toBe(false);

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Unfollowed. 1 other person still follows Trash Taste.'));
    expect(mocks.toast.mock.calls[0]).toHaveLength(1);
  });

  it('does the same for a Twitch streamer', async () => {
    const fetchMock = respond({
      'GET /api/twitch/streamers/c1': channel({ followers: 2 }),
      'DELETE /api/twitch/subscriptions/s1': { ok: true, othersFollowing: 1, autoDownload: true },
      'GET /api/twitch/policies?streamerId=c1': { streamer: null },
      'PUT /api/twitch/policies': { ok: true },
    });
    await renderPage('twitch');
    expect(screen.getByText(/Followed by 2 people/)).toBeTruthy();
    await unfollow('Unsubscribe');

    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    const [message, options] = mocks.toast.mock.calls[0] as [string, { action: { onClick: () => void } }];
    expect(message).toBe('Unsubscribed. 1 other person still follows Trash Taste, so new videos can still download.');
    options.action.onClick();
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(put[1]!.body as string)).toEqual({ streamerId: 'c1', policy: { autoDownload: false }, typePolicies: {} });
  });

  it('warns the last follower when a followed playlist still brings the channel in', async () => {
    respond({
      'GET /api/youtube/channels/c1': channel({ followers: 1 }),
      'DELETE /api/youtube/subscriptions/s1': { ok: true, othersFollowing: 0, autoDownload: true },
    });
    await renderPage();
    await unfollow();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.toast.mock.calls[0][0]).toBe('Unfollowed. A followed playlist still includes Trash Taste, so new videos can still download.');
  });

  it('says nothing more when nobody else follows', async () => {
    const fetchMock = respond({
      'GET /api/youtube/channels/c1': channel({ followers: 1 }),
      'DELETE /api/youtube/subscriptions/s1': { ok: true, othersFollowing: 0, autoDownload: false },
    });
    await renderPage();
    await unfollow();
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true));
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
