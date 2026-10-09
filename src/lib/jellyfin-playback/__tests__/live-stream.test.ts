import { describe, expect, it } from 'vitest';
import { isLiveStream } from '@/lib/jellyfin-playback/live-stream';

const channel = { Id: 'channel', Type: 'TvChannel' };
const film = { Id: 'film', Type: 'Movie' };
const streamOf = (item: { Id: string }, IsInfiniteStream?: boolean) => ({ item, mediaSource: { IsInfiniteStream } });

describe('isLiveStream', () => {
  it('follows the source Jellyfin negotiated', () => {
    // A tuned channel on Jellyfin 12.2.0: IsInfiniteStream true, RunTimeTicks null.
    expect(isLiveStream(channel, streamOf(channel, true))).toBe(true);
    // An item that is not a channel but is still being broadcast.
    const recording = { Id: 'recording', Type: 'Recording' };
    expect(isLiveStream(recording, streamOf(recording, true))).toBe(true);
  });

  it('knows a channel before its source arrives', () => {
    expect(isLiveStream(channel)).toBe(true);
    expect(isLiveStream(channel, null)).toBe(true);
    // The film that was playing is still on the player while the channel tunes.
    expect(isLiveStream(channel, streamOf(film, false))).toBe(true);
  });

  it('leaves files alone', () => {
    expect(isLiveStream(film, streamOf(film, false))).toBe(false);
    expect(isLiveStream({ Id: 'episode', Type: 'Episode' }, streamOf({ Id: 'episode' }))).toBe(false);
    // A finished recording is a file like any other.
    const recording = { Id: 'recording', Type: 'Recording' };
    expect(isLiveStream(recording, streamOf(recording, false))).toBe(false);
    expect(isLiveStream(null)).toBe(false);
  });

  it('ignores a source left over from the previous item', () => {
    // Starting a film from a channel: until the film's stream arrives, the
    // queue has moved on and the stream has not.
    expect(isLiveStream(film, streamOf(channel, true))).toBe(false);
  });
});
