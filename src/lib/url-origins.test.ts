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

  it('leaves text without URLs alone', () => {
    expect(urlsToOrigins('Indexer is disabled till tomorrow')).toBe('Indexer is disabled till tomorrow');
  });
});
