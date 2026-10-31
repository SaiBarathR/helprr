// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countEnabledContextActions } from '@/components/ui/quick-context-menu';
import type { TwitchVideo, TwitchVideoPage } from './types';

const mocks = vi.hoisted(() => ({
  capabilities: {} as Record<string, boolean>,
  push: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/components/permission-provider', () => ({
  useMe: () => ({ role: 'member', capabilities: mocks.capabilities }),
  hasCapability: (_me: unknown, capability: string) => mocks.capabilities[capability] === true,
}));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: mocks.push }) }));
vi.mock('./download-sheet', () => ({ DownloadSheet: () => null }));
vi.mock('sonner', () => ({ toast: Object.assign(mocks.toast, { success: vi.fn(), error: vi.fn() }) }));

import { useVideoActions } from './use-video-actions';

const video: TwitchVideo = {
  id: 'video-1',
  twitchVideoId: '100',
  type: 'ARCHIVE',
  title: 'A stream',
  description: null,
  twitchCreatedAt: '2026-10-20T00:00:00.000Z',
  durationSeconds: 3600,
  thumbnailUrl: null,
  category: null,
  viewCount: 1,
  mutedSegments: null,
  chapters: null,
  availability: 'PUBLISHED',
  estimatedExpiresAt: null,
  streamer: { id: 'streamer-1', login: 'gigguk', displayName: 'Gigguk', profileImageUrl: null, isLive: false },
  seen: true,
  downloaded: false,
  fileId: null,
  jellyfinItemId: null,
  activeJob: null,
};
const saved = { ...video, downloaded: true, fileId: 'file-1', jellyfinItemId: 'item-1' };
const downloading = { ...video, activeJob: { id: 'job-1', state: 'RUNNING', stage: null, progress: 0.4 } };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(() => useVideoActions(), { wrapper }) };
}

const ids = (groups: ReturnType<ReturnType<typeof useVideoActions>['groupsFor']>) =>
  groups.flatMap((group) => group.actions.map((action) => action.id));

describe('useVideoActions', () => {
  beforeEach(() => {
    mocks.capabilities = { 'twitch.view': true, 'twitch.download': true, 'twitch.manage': true };
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // QuickContextMenu switches itself off below two enabled actions.
  it.each([['new', video], ['saved', saved], ['downloading', downloading]])('gives a %s video a long-press menu', (_name, item) => {
    const { result } = setup();
    expect(countEnabledContextActions(result.current.groupsFor(item))).toBeGreaterThanOrEqual(2);
  });

  it('only offers a download to a user who may download', () => {
    const { result, rerender } = setup();
    expect(ids(result.current.groupsFor(video))).toContain('quick');
    expect(result.current.swipeFor(video).leftAction?.label).toBe('Download');

    mocks.capabilities = { 'twitch.view': true };
    rerender();
    expect(ids(result.current.groupsFor(video))).not.toContain('quick');
    expect(result.current.swipeFor(video).leftAction).toBeUndefined();
  });

  it('only offers deleting a settled file to a manager', () => {
    const { result, rerender } = setup();
    expect(ids(result.current.groupsFor(saved))).toContain('delete');
    expect(result.current.swipeFor(saved).rightAction.label).toBe('Delete');
    expect(ids(result.current.groupsFor({ ...saved, activeJob: downloading.activeJob }))).not.toContain('delete');

    mocks.capabilities = { 'twitch.view': true, 'twitch.download': true };
    rerender();
    expect(ids(result.current.groupsFor(saved))).not.toContain('delete');
    expect(result.current.swipeFor(saved).rightAction.label).toBe('Hide');
  });

  it('swipes to Play once the video is in Jellyfin', () => {
    const { result } = setup();
    result.current.swipeFor(saved).leftAction?.onAction();
    expect(mocks.push).toHaveBeenCalledWith('/jellyfin/library/item/item-1');
  });

  it('adds Select to the menu only where the page offers it', () => {
    const { result } = setup();
    expect(ids(result.current.groupsFor(video))).not.toContain('select');
    expect(ids(result.current.groupsFor(video, () => undefined))).toContain('select');
  });

  it('gives every hide its own Undo, even when two overlap', async () => {
    const { result } = setup();
    act(() => {
      result.current.swipeFor(video).rightAction.onAction();
      result.current.swipeFor({ ...video, id: 'video-2' }).rightAction.onAction();
    });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(2));
  });

  it('hides from every cached feed list at once and can be undone', async () => {
    const { client, result } = setup();
    const page: TwitchVideoPage = { videos: [video, { ...video, id: 'video-2' }], total: 2, page: 1, pageSize: 30 };
    client.setQueryData(['twitch', 'feed', 'list'], { pages: [page], pageParams: [1] });
    client.setQueryData(['twitch', 'feed', 'expiring-shelf'], page);

    act(() => result.current.swipeFor(video).rightAction.onAction());

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    const list = client.getQueryData<{ pages: TwitchVideoPage[] }>(['twitch', 'feed', 'list']);
    expect(list?.pages[0].videos.map((item) => item.id)).toEqual(['video-2']);
    expect(client.getQueryData<TwitchVideoPage>(['twitch', 'feed', 'expiring-shelf'])?.videos.map((item) => item.id)).toEqual(['video-2']);

    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    const undo = mocks.toast.mock.calls[0][1].action.onClick as () => void;
    act(() => undo());
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
      '/api/twitch/videos/video-1/state',
      expect.objectContaining({ body: JSON.stringify({ hidden: false }) }),
    ));
  });
});
