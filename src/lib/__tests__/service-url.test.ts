import { describe, expect, it } from 'vitest';
import { normalizeServiceUrl } from '@/lib/service-url';

// The server reuses a saved secret only for the URL it was saved with, and the
// settings form warns when an edit would break that. Both compare URLs through
// this, so what counts as "the same URL" is decided in one place.
describe('normalizeServiceUrl', () => {
  it.each([
    ['http://sonarr.lan:8989', 'http://sonarr.lan:8989'],
    ['http://sonarr.lan:8989/', 'http://sonarr.lan:8989'],
    ['  http://sonarr.lan:8989///  ', 'http://sonarr.lan:8989'],
    ['https://host/sonarr/', 'https://host/sonarr'],
  ])('reads %j as %j', (input, expected) => {
    expect(normalizeServiceUrl(input)).toBe(expected);
  });

  it.each([
    ['another port', 'http://sonarr.lan:8990'],
    ['another scheme', 'https://sonarr.lan:8989'],
    ['another path', 'http://sonarr.lan:8989/sonarr'],
    ['another case', 'http://Sonarr.lan:8989'],
  ])('keeps %s distinct', (_label, other) => {
    expect(normalizeServiceUrl(other)).not.toBe(normalizeServiceUrl('http://sonarr.lan:8989'));
  });
});
