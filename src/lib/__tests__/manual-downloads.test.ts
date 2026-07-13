import { describe, expect, it } from 'vitest';
import {
  buildArrReleasePushPayload,
  buildManualDownloadRequestKey,
  getMagnetReleaseTitle,
  hasNewArrFileId,
} from '@/lib/manual-downloads';

const HASH = '0123456789abcdef0123456789abcdef01234567';

function magnet(title?: string) {
  return `magnet:?xt=urn:btih:${HASH}${title ? `&dn=${encodeURIComponent(title)}` : ''}`;
}

describe('Arr-managed magnet payloads', () => {
  it('preserves a Sonarr single-episode release title for Arr parsing', () => {
    const url = magnet('Example.Show.S02E07.1080p.WEB-DL');
    expect(buildArrReleasePushPayload({
      service: 'SONARR', arrItemId: 42, magnetUrl: url, infoHash: HASH,
      publishDate: '2026-07-12T12:00:00.000Z',
    })).toEqual(expect.objectContaining({
      title: 'Example.Show.S02E07.1080p.WEB-DL', seriesId: 42,
      magnetUrl: url, infoHash: HASH, protocol: 'torrent', shouldOverride: true,
    }));
  });

  it('preserves a Sonarr season-pack release title for Arr parsing', () => {
    const url = magnet('Example.Show.S03.Complete.1080p.WEB-DL');
    const payload = buildArrReleasePushPayload({
      service: 'SONARR', arrItemId: 9, magnetUrl: url, infoHash: HASH,
      publishDate: '2026-07-12T12:00:00.000Z',
    });
    expect(payload.title).toBe('Example.Show.S03.Complete.1080p.WEB-DL');
    expect(payload).toHaveProperty('seriesId', 9);
    expect(payload).not.toHaveProperty('movieId');
  });

  it('targets the created Radarr movie without adding Sonarr fields', () => {
    const url = magnet('Example.Movie.2026.1080p.BluRay');
    const payload = buildArrReleasePushPayload({
      service: 'RADARR', arrItemId: 17, magnetUrl: url, infoHash: HASH,
      publishDate: '2026-07-12T12:00:00.000Z',
    });
    expect(payload).toHaveProperty('movieId', 17);
    expect(payload).not.toHaveProperty('seriesId');
    expect(payload.title).toBe('Example.Movie.2026.1080p.BluRay');
  });

  it('rejects magnets without a display name because Arr cannot parse their contents', () => {
    const url = magnet();
    expect(getMagnetReleaseTitle(url)).toBeNull();
    expect(() => buildArrReleasePushPayload({
      service: 'SONARR', arrItemId: 1, magnetUrl: url, infoHash: HASH,
      publishDate: '2026-07-12T12:00:00.000Z',
    })).toThrow('display name');
  });

  it('builds a stable idempotency key without storing tracker parameters', () => {
    const first = buildManualDownloadRequestKey({ actorId: 'user-1', instanceId: 'sonarr-hd', externalId: 100, infoHash: HASH });
    const retry = buildManualDownloadRequestKey({ actorId: 'user-1', instanceId: 'sonarr-hd', externalId: 100, infoHash: HASH.toUpperCase() });
    expect(retry).toBe(first);
    expect(first).not.toContain(HASH);
  });

  it('marks import complete only for an exact new Arr file id', () => {
    expect(hasNewArrFileId([10, 11], [10, 11])).toBe(false);
    expect(hasNewArrFileId([10, 11], [10, 11, 12])).toBe(true);
    expect(hasNewArrFileId(null, [])).toBe(false);
  });
});
