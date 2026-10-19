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
});
