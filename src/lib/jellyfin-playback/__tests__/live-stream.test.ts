import { describe, expect, it } from 'vitest';
import { isLiveStream } from '@/lib/jellyfin-playback/live-stream';

describe('isLiveStream', () => {
  it('follows the source Jellyfin negotiated', () => {
    // A tuned channel on Jellyfin 12.2.0: IsInfiniteStream true, RunTimeTicks null.
    expect(isLiveStream({ Type: 'TvChannel' }, { IsInfiniteStream: true })).toBe(true);
    // An item that is not a channel but is still being broadcast.
    expect(isLiveStream({ Type: 'Recording' }, { IsInfiniteStream: true })).toBe(true);
  });

  it('knows a channel before its source arrives', () => {
    expect(isLiveStream({ Type: 'TvChannel' })).toBe(true);
    expect(isLiveStream({ Type: 'TvChannel' }, null)).toBe(true);
  });

  it('leaves files alone', () => {
    expect(isLiveStream({ Type: 'Movie' }, { IsInfiniteStream: false })).toBe(false);
    expect(isLiveStream({ Type: 'Episode' }, {})).toBe(false);
    // A finished recording is a file like any other.
    expect(isLiveStream({ Type: 'Recording' }, { IsInfiniteStream: false })).toBe(false);
    expect(isLiveStream(null)).toBe(false);
  });
});
