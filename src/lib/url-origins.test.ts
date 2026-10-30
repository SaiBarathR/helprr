import { describe, expect, it } from 'vitest';
import { urlsToOrigins } from '@/lib/url-origins';

describe('urlsToOrigins', () => {
  it('keeps only the origin of every URL, dropping path, query and credentials', () => {
    expect(urlsToOrigins('failed at [https://beyond-hd.example/api/torrents/abc123]')).toBe('failed at [https://beyond-hd.example]');
    expect(urlsToOrigins('see https://tracker.example/rss?passkey=abc and http://user:pw@host.example:8080/x')).toBe(
      'see https://tracker.example and http://host.example:8080',
    );
  });

  it('keeps punctuation that follows a URL', () => {
    expect(urlsToOrigins('Failed (https://host.example/a?apikey=1). Retry at https://host.example/b, later.')).toBe(
      'Failed (https://host.example). Retry at https://host.example, later.',
    );
  });

  it('covers other schemes, JSON-escaped URLs and magnet links', () => {
    expect(urlsToOrigins('announce udp://tracker.example:6969/0123456789abcdef/announce?passkey=1')).toBe(
      'announce udp://tracker.example:6969',
    );
    expect(urlsToOrigins('{"u":"https:\\/\\/tracker.example\\/api\\/0123456789abcdef"}')).toBe(
      '{"u":"https://tracker.example"}',
    );
    expect(urlsToOrigins('magnet:?xt=urn:btih:abc&tr=https%3A%2F%2Ft.example%2Fannounce%3Fpasskey%3D1 failed')).toBe(
      'magnet:[REDACTED] failed',
    );
  });

  it('keeps an IPv6 host intact', () => {
    expect(urlsToOrigins('at https://[2001:db8::1] and [https://[2001:db8::1]:9696/x?apikey=1].')).toBe(
      'at https://[2001:db8::1] and [https://[2001:db8::1]:9696].',
    );
  });

  it('leaves text without URLs alone', () => {
    expect(urlsToOrigins('Indexer is disabled till tomorrow')).toBe('Indexer is disabled till tomorrow');
  });
});
