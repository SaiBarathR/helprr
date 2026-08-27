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
});
