import { describe, expect, it } from 'vitest';
import {
  isAllowedMediaPath,
  itemIdFromMediaPath,
  normalizeMediaPath,
  stripSensitiveQuery,
} from '@/lib/jellyfin-playback/media-path';
import { rewriteHlsPlaylist } from '@/lib/jellyfin-playback/hls-rewrite';
import { buildHelprrStreamInfo } from '@/lib/jellyfin-playback/stream-info';
import type { JellyfinItem, JellyfinMediaSource } from '@/types/jellyfin';

describe('jellyfin media path allowlist', () => {
  it('allows playback and subtitle paths and rejects admin APIs', () => {
    expect(isAllowedMediaPath('/videos/abc123def456/master.m3u8')).toBe(true);
    expect(isAllowedMediaPath('/Videos/abc123def456/stream.mp4')).toBe(true);
    expect(isAllowedMediaPath('/audio/abc123def456/universal')).toBe(true);
    expect(isAllowedMediaPath('/videos/abc123def456/mediaSource/subtitles/1/stream.vtt')).toBe(true);
    expect(isAllowedMediaPath('/Users')).toBe(false);
    expect(isAllowedMediaPath('/System/Info')).toBe(false);
    expect(isAllowedMediaPath('/videos/../System/Info')).toBe(false);
    expect(itemIdFromMediaPath('/videos/abc-123/hls1/main/seg.ts')).toBe('abc-123');
  });

  it('strips Jellyfin API keys from query strings', () => {
    const params = stripSensitiveQuery(new URLSearchParams('MediaSourceId=1&api_key=secret&PlaySessionId=p'));
    expect(params.get('api_key')).toBeNull();
    expect(params.get('MediaSourceId')).toBe('1');
    expect(normalizeMediaPath('https://jellyfin.example/videos/abc/master.m3u8')).toBe('/videos/abc/master.m3u8');
  });
});

describe('jellyfin media path allowlist — non-playback paths', () => {
  it('rejects Live TV pseudo-paths; channels play through /videos/{id} with a LiveStreamId', () => {
    // jellyfin-web's playbackmanager puts LiveStreamId on the channel item's own
    // video URL rather than using a /LiveTv/ media path, so allowing one here
    // would have been an unauthenticated hole with no caller.
    expect(isAllowedMediaPath('/livetv/livestream')).toBe(false);
    expect(isAllowedMediaPath('/LiveTv/LiveStreamFiles/abc/stream.mp4')).toBe(false);
    expect(isAllowedMediaPath('/videos/abc123def456/master.m3u8?LiveStreamId=x')).toBe(true);
  });

  it('still allows the static fallback font libass needs', () => {
    expect(isAllowedMediaPath('/FallbackFont/Fonts/whatever.woff2')).toBe(true);
  });

  it('rejects traversal, protocol-relative, and backslash paths', () => {
    expect(isAllowedMediaPath('/videos/abc123def456/../../System/Info')).toBe(false);
    expect(normalizeMediaPath('//evil.example/videos/abc/x.ts')).toBeNull();
    expect(normalizeMediaPath('/videos/abc//x.ts')).toBeNull();
  });

  // The upstream URL parser reads these as `..` after the checks have run.
  it.each([
    '/fallbackfont/fonts/%2e%2e/%2e%2e/System/Info',
    '/videos/abc123def456/%2E./%2e%2E/Users',
    '/videos/abc123def456/.\t./.\t./Users',
    '/videos/abc123def456/.\n./Users',
  ])('rejects %j, which would be re-read as a traversal', (path) => {
    expect(normalizeMediaPath(path)).toBeNull();
    expect(isAllowedMediaPath(path)).toBe(false);
    // What the parser would have made of it had it been let through.
    expect(new URL(path, 'http://jellyfin.test/').pathname).not.toContain('abc123def456');
  });

  it('still allows a font file name with a space', () => {
    expect(isAllowedMediaPath('/FallbackFont/Fonts/Noto Sans CJK.ttf')).toBe(true);
  });

  it('allows trickplay sheets, which share the /videos/{id} prefix', () => {
    expect(isAllowedMediaPath('/Videos/abc123def456/Trickplay/320/0.jpg')).toBe(true);
    expect(itemIdFromMediaPath('/Videos/abc123def456/Trickplay/320/0.jpg')).toBe('abc123def456');
  });

  it('strips token query keys regardless of casing', () => {
    const params = stripSensitiveQuery(new URLSearchParams('ApiKey=a&API_KEY=b&X-Emby-Token=c&MediaSourceId=keep'));
    expect(params.get('ApiKey')).toBeNull();
    expect(params.get('API_KEY')).toBeNull();
    expect(params.get('X-Emby-Token')).toBeNull();
    expect(params.get('MediaSourceId')).toBe('keep');
  });
});

describe('hls playlist rewrite', () => {
  it('rewrites segment URIs through the Helprr proxy without api keys', () => {
    const body = [
      '#EXTM3U',
      '#EXT-X-MAP:URI="init.mp4"',
      'https://jellyfin.example/videos/abc/hls1/main/seg.ts?api_key=secret',
      'seg2.ts',
    ].join('\n');
    const rewritten = rewriteHlsPlaylist(body, 'https://jellyfin.example', '/videos/abc/master.m3u8');
    expect(rewritten).toContain('/api/jellyfin/media/videos/abc/hls1/main/seg.ts');
    expect(rewritten).not.toContain('api_key');
    expect(rewritten).toContain('/api/jellyfin/media/videos/abc/init.mp4');
    expect(rewritten).toContain('/api/jellyfin/media/videos/abc/seg2.ts');
  });
});

describe('hls playlist rewrite — edge cases', () => {
  it('rewrites EXT-X-KEY and EXT-X-MEDIA URIs, not just segment lines', () => {
    const body = [
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=AES-128,URI="https://jellyfin.example/videos/abc/hls1/key?api_key=secret"',
      '#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/main.m3u8"',
      'seg.ts',
    ].join('\n');
    const out = rewriteHlsPlaylist(body, 'https://jellyfin.example', '/videos/abc/master.m3u8');
    expect(out).toContain('URI="/api/jellyfin/media/videos/abc/hls1/key"');
    expect(out).toContain('URI="/api/jellyfin/media/videos/abc/audio/main.m3u8"');
    expect(out).not.toContain('api_key');
  });

  it('handles CRLF playlists and preserves tags that carry no URI', () => {
    const body = '#EXTM3U\r\n#EXT-X-TARGETDURATION:6\r\n#EXTINF:6.0,\r\nseg0.ts\r\n';
    const out = rewriteHlsPlaylist(body, 'https://jellyfin.example', '/videos/abc/main.m3u8');
    expect(out).toContain('#EXT-X-TARGETDURATION:6');
    expect(out).toContain('#EXTINF:6.0,');
    expect(out).toContain('/api/jellyfin/media/videos/abc/seg0.ts');
  });

  it('leaves URIs on other origins alone rather than proxying them', () => {
    const body = '#EXTM3U\nhttps://cdn.elsewhere.example/seg.ts';
    const out = rewriteHlsPlaylist(body, 'https://jellyfin.example', '/videos/abc/main.m3u8');
    expect(out).toContain('https://cdn.elsewhere.example/seg.ts');
    expect(out).not.toContain('/api/jellyfin/media/seg.ts');
  });

  it('resolves nested variant paths against the playlist directory', () => {
    const body = '#EXTM3U\nhls1/main/0.mp4';
    const out = rewriteHlsPlaylist(body, 'https://jellyfin.example', '/videos/abc/hls1/main.m3u8');
    expect(out).toContain('/api/jellyfin/media/videos/abc/hls1/hls1/main/0.mp4');
  });
});

describe('stream info builder', () => {
  it('prefers direct play and proxies the stream URL', () => {
    const item: JellyfinItem = { Id: 'item1', Name: 'Movie', Type: 'Movie', MediaType: 'Video' };
    const source: JellyfinMediaSource = {
      Id: 'src1',
      Container: 'mp4',
      SupportsDirectPlay: true,
      SupportsDirectStream: true,
      MediaStreams: [],
    };
    const result = buildHelprrStreamInfo({
      item,
      playback: { PlaySessionId: 'play-1', MediaSources: [source] },
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.playMethod).toBe('DirectPlay');
    expect(result.mediaUrl).toContain('/api/jellyfin/media/Videos/item1/stream.mp4');
    expect(result.playSessionId).toBe('play-1');
  });

  it('uses transcoding URLs for HLS', () => {
    const item: JellyfinItem = { Id: 'item1', Name: 'Movie', Type: 'Movie', MediaType: 'Video' };
    const source: JellyfinMediaSource = {
      Id: 'src1',
      Container: 'mkv',
      SupportsDirectPlay: false,
      SupportsDirectStream: false,
      SupportsTranscoding: true,
      TranscodingSubProtocol: 'hls',
      TranscodingUrl: '/videos/item1/master.m3u8?api_key=secret&PlaySessionId=p2',
    };
    const result = buildHelprrStreamInfo({
      item,
      playback: { MediaSources: [source] },
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.playMethod).toBe('Transcode');
    expect(result.mediaUrl.startsWith('/api/jellyfin/media/videos/item1/master.m3u8')).toBe(true);
    expect(result.mediaUrl).not.toContain('api_key');
  });

  // Jellyfin signs the URLs it returns with the member's own access token, and
  // a remote source's path and headers can hold its provider's credentials.
  it.each([
    ['a transcode', {}],
    ['a direct stream', { SupportsDirectStream: true }],
  ])('returns no upstream URL or credential for %s', (_label, support) => {
    // Jellyfin's single-item response repeats the media source, with its path.
    const item: JellyfinItem = {
      Id: 'item1',
      Name: 'Movie',
      Type: 'Movie',
      MediaType: 'Video',
      Path: '/media/SECRET/movie.strm',
      MediaSources: [{
        Id: 'src1',
        Container: 'mkv',
        Path: 'https://iptv.example/ch1.m3u8?access_token=SECRET',
        MediaStreams: [{ Type: 'Video', Index: 0, Path: '/media/SECRET/movie.mkv' }],
      }],
    };
    const source = {
      Id: 'src1',
      Container: 'mkv',
      Bitrate: 8_000_000,
      RunTimeTicks: 72_000_000_000,
      DefaultAudioStreamIndex: 1,
      DefaultSubtitleStreamIndex: 2,
      IsInfiniteStream: false,
      SupportsTranscoding: true,
      TranscodingSubProtocol: 'hls',
      TranscodingUrl: '/videos/item1/master.m3u8?MediaSourceId=src1&ApiKey=SECRET&PlaySessionId=p2',
      DirectStreamUrl: '/videos/item1/stream.mkv?api_key=SECRET',
      Path: 'https://iptv.example/ch1.m3u8?access_token=SECRET',
      EncoderPath: 'http://127.0.0.1:8096/LiveTv/LiveStreamFiles/x/stream.ts?X-Emby-Token=SECRET',
      OpenToken: 'SECRET',
      RequiredHttpHeaders: { Authorization: 'Bearer SECRET' },
      MediaStreams: [
        { Type: 'Audio', Index: 1, Codec: 'aac' },
        { Type: 'Subtitle', Index: 2, Codec: 'subrip', DeliveryMethod: 'External', Path: '/media/SECRET/movie.en.srt', DeliveryUrl: '/Videos/item1/src1/Subtitles/2/0/Stream.vtt?ApiKey=SECRET' },
      ],
      MediaAttachments: [{ Index: 0, FileName: 'font.ttf', DeliveryUrl: '/Videos/item1/src1/Attachments/0?api_key=SECRET' }],
      ...support,
    } as JellyfinMediaSource;
    const result = buildHelprrStreamInfo({ item, playback: { MediaSources: [source] } });
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    const json = JSON.stringify(result);
    expect(json).not.toContain('SECRET');
    expect(json).not.toMatch(/api_?key|access_?token|x-emby-token|x-mediabrowser-token/i);
    // What the player reads is still there.
    expect(result.mediaSource).toEqual({
      Id: 'src1',
      Container: 'mkv',
      Bitrate: 8_000_000,
      RunTimeTicks: 72_000_000_000,
      DefaultAudioStreamIndex: 1,
      DefaultSubtitleStreamIndex: 2,
      IsInfiniteStream: false,
      MediaStreams: [
        { Type: 'Audio', Index: 1, Codec: 'aac' },
        { Type: 'Subtitle', Index: 2, Codec: 'subrip', DeliveryMethod: 'External', DeliveryUrl: '/api/jellyfin/media/Videos/item1/src1/Subtitles/2/0/Stream.vtt' },
      ],
      MediaAttachments: [{ Index: 0, FileName: 'font.ttf', DeliveryUrl: '/api/jellyfin/media/Videos/item1/src1/Attachments/0' }],
    });
    expect(result.subtitleTracks[0].url).toBe('/api/jellyfin/media/Videos/item1/src1/Subtitles/2/0/Stream.vtt');
    expect(result.playSessionId).toBe('p2');
  });
});
