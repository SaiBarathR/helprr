import { describe, expect, it, vi } from 'vitest';
import { buildMarkWatchedContextAction } from '@/lib/mark-watched-context-action';
import type { WatchStatus } from '@/types/watch-status';

const movieStatus: WatchStatus = {
  kind: 'movie',
  jellyfinItemId: 'jf-1',
  played: false,
  playedPercentage: 0,
};

describe('buildMarkWatchedContextAction', () => {
  it('returns null without write capability', () => {
    expect(buildMarkWatchedContextAction({
      status: movieStatus,
      canWrite: false,
      isWriting: false,
      setWatched: vi.fn(),
    })).toBeNull();
  });

  it('returns null without Jellyfin match', () => {
    expect(buildMarkWatchedContextAction({
      status: undefined,
      canWrite: true,
      isWriting: false,
      setWatched: vi.fn(),
    })).toBeNull();
  });

  it('builds mark-as-watched action', () => {
    const setWatched = vi.fn();
    const action = buildMarkWatchedContextAction({
      status: movieStatus,
      canWrite: true,
      isWriting: false,
      setWatched,
    });
    expect(action?.label).toBe('Mark as watched');
    action?.onSelect?.();
    expect(setWatched).toHaveBeenCalledWith({ jellyfinItemId: 'jf-1', played: true, seriesId: undefined });
  });

  it('builds mark-as-unwatched when fully watched', () => {
    const setWatched = vi.fn();
    const action = buildMarkWatchedContextAction({
      status: { ...movieStatus, played: true, playedPercentage: 100 },
      canWrite: true,
      isWriting: false,
      setWatched,
    });
    expect(action?.label).toBe('Mark as unwatched');
    action?.onSelect?.();
    expect(setWatched).toHaveBeenCalledWith({ jellyfinItemId: 'jf-1', played: false, seriesId: undefined });
  });
});
