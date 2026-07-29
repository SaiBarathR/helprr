import { describe, expect, it } from 'vitest';
import { toAuthenticatedLidarrImageUrl } from '@/lib/lidarr-image';

describe('toAuthenticatedLidarrImageUrl', () => {
  const base = new URL('http://lidarr.internal:8686/');

  it('maps artist artwork to Lidarr authenticated media-cover endpoints', () => {
    const target = new URL(
      'http://lidarr.internal:8686/MediaCover/4/poster.jpg?lastWrite=639025056322956101',
    );

    expect(toAuthenticatedLidarrImageUrl(target, base).toString()).toBe(
      'http://lidarr.internal:8686/api/v1/mediacover/artist/4/poster.jpg?lastWrite=639025056322956101',
    );
  });

  it('maps album artwork to Lidarr authenticated media-cover endpoints', () => {
    const target = new URL(
      'http://lidarr.internal:8686/MediaCover/Albums/27/cover.png?lastWrite=123',
    );

    expect(toAuthenticatedLidarrImageUrl(target, base).toString()).toBe(
      'http://lidarr.internal:8686/api/v1/mediacover/album/27/cover.png?lastWrite=123',
    );
  });

  it('preserves a reverse-proxy URL base', () => {
    const proxyBase = new URL('https://media.example.com/lidarr');
    const target = new URL(
      'https://media.example.com/lidarr/MediaCover/9/fanart.jpg?lastWrite=456',
    );

    expect(toAuthenticatedLidarrImageUrl(target, proxyBase).toString()).toBe(
      'https://media.example.com/lidarr/api/v1/mediacover/artist/9/fanart.jpg?lastWrite=456',
    );
  });

  it.each([
    'https://images.lidarr.audio/cover/artist.jpg',
    'http://other.internal:8686/MediaCover/4/poster.jpg',
    'http://lidarr.internal:8686/api/v1/mediacover/artist/4/poster.jpg',
    'http://lidarr.internal:8686/MediaCover/not-an-id/poster.jpg',
    'http://lidarr.internal:8686/MediaCover/4/poster.jpeg',
    'http://lidarr.internal:8686/MediaCover/4/poster.webp',
  ])('leaves non-matching image URLs unchanged: %s', (src) => {
    const target = new URL(src);

    expect(toAuthenticatedLidarrImageUrl(target, base)).toBe(target);
  });
});
