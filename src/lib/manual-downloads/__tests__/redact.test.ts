import { describe, expect, it } from 'vitest';
import { redactUpstreamText } from '../redact';

describe('upstream text kept on a download', () => {
  it('drops credentials, passkeys and magnet links, and keeps the rest', () => {
    expect(redactUpstreamText('Failed to fetch https://tracker.example/announce?passkey=abc123&info=1')).toBe('Failed to fetch https://tracker.example/announce?passkey=[REDACTED]&info=1');
    expect(redactUpstreamText('GET http://qbit:8080/api?apikey=s3cret failed')).toBe('GET http://qbit:8080/api?apikey=[REDACTED] failed');
    expect(redactUpstreamText('Unable to connect to http://admin:hunter2@qbit:8080')).toBe('Unable to connect to http://admin:[REDACTED]@qbit:8080');
    expect(redactUpstreamText('Rejected magnet:?xt=urn:btih:abc&tr=http://t/announce?passkey=x')).toBe('Rejected magnet:[REDACTED]');
    expect(redactUpstreamText('Unknown is not wanted in profile')).toBe('Unknown is not wanted in profile');
  });

  it('blanks a magnet\'s trackers when its name has spaces and ends the magnet match early', () => {
    const tracker = 'http%3a%2f%2ftracker.example%2fa1b2c3d4e5f60718293a4b5c6d7e8f90%2fannounce';
    const text = redactUpstreamText(`Grabbed magnet:?xt=urn:btih:ABC&dn=Big Buck Bunny 2008&tr=${tracker}&tr.1=udp%3a%2f%2fopen.example%3a1337&ws=https%3a%2f%2fseed.example%2fkey9`);

    expect(text).toBe('Grabbed magnet:[REDACTED] Buck Bunny 2008&tr=[REDACTED]&tr.1=[REDACTED]&ws=[REDACTED]');
    expect(text).not.toContain('a1b2c3d4');
  });
});
