import { describe, expect, it } from 'vitest';
import { withoutSignedLinks } from './redact-links';

describe('withoutSignedLinks', () => {
  it('removes a YouTube media link whole, as its signature can be in the path', () => {
    const text = 'ERROR: unable to download https://rr1---sn-abc.googlevideo.com/videoplayback?expire=1&sig=SECRET and https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/1/sig/SECRET/file/index.m3u8';
    const clean = withoutSignedLinks(text);
    expect(clean).not.toContain('SECRET');
    expect(clean).toBe('ERROR: unable to download [YouTube media link removed] and [YouTube media link removed]');
  });

  it('keeps where other links went, without their query', () => {
    expect(withoutSignedLinks('HTTP Error 403 on https://usher.ttvnw.net/vod/123.m3u8?sig=abc&token=xyz.'))
      .toBe('HTTP Error 403 on https://usher.ttvnw.net/vod/123.m3u8?[removed].');
  });

  it('leaves plain links and text alone', () => {
    expect(withoutSignedLinks('Sign in to confirm your age. See https://www.youtube.com/watch')).toBe('Sign in to confirm your age. See https://www.youtube.com/watch');
  });
});
