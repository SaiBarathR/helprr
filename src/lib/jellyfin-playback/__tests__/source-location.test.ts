import { describe, expect, it } from 'vitest';
import { withoutSourceLocation } from '@/lib/jellyfin-playback/source-location';
import type { JellyfinItem } from '@/types/jellyfin';

describe('withoutSourceLocation', () => {
  it('drops where the file lives and keeps what the item page shows', () => {
    const item = {
      Id: 'item1',
      Name: 'Channel',
      Type: 'TvChannel',
      Path: 'https://iptv.example/live/user/SECRET/1.ts',
      Chapters: [{ StartPositionTicks: 0, Name: 'Opening', ImageTag: 'tag', ImagePath: '/config/metadata/SECRET/chapters/0.jpg' }],
      MediaStreams: [
        { Type: 'Video', Index: 0, Codec: 'h264' },
        { Type: 'Subtitle', Index: 2, Codec: 'subrip', IsExternal: true, Path: '/media/SECRET/film.en.srt' },
      ],
      MediaSources: [{
        Id: 'src1',
        Container: 'mkv',
        Size: 2_500_000_000,
        Bitrate: 16_000_000,
        Path: 'https://iptv.example/live/user/SECRET/1.ts',
        EncoderPath: 'http://127.0.0.1:8096/LiveTv/LiveStreamFiles/SECRET/stream.ts',
        RequiredHttpHeaders: { Authorization: 'Bearer SECRET' },
        MediaStreams: [{ Type: 'Video', Index: 0, Path: '/media/SECRET/film.mkv' }],
      }],
    } as unknown as JellyfinItem;

    const safe = withoutSourceLocation(item);

    expect(JSON.stringify(safe)).not.toContain('SECRET');
    expect(JSON.parse(JSON.stringify(safe))).toEqual({
      Id: 'item1',
      Name: 'Channel',
      Type: 'TvChannel',
      Chapters: [{ StartPositionTicks: 0, Name: 'Opening', ImageTag: 'tag' }],
      MediaStreams: [
        { Type: 'Video', Index: 0, Codec: 'h264' },
        { Type: 'Subtitle', Index: 2, Codec: 'subrip', IsExternal: true },
      ],
      MediaSources: [{ Id: 'src1', Container: 'mkv', Size: 2_500_000_000, Bitrate: 16_000_000 }],
    });
  });

  it('leaves an item without streams or sources as it is', () => {
    const item: JellyfinItem = { Id: 'series1', Name: 'Series', Type: 'Series' };
    expect(JSON.parse(JSON.stringify(withoutSourceLocation(item)))).toEqual(item);
  });
});
