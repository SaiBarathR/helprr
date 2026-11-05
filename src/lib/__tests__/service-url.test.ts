import { describe, expect, it } from 'vitest';
import { normalizeServiceUrl, servicePageUrl } from '@/lib/service-url';
import { SERVICE_CONFIG } from '@/lib/settings/service-config';

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

describe('servicePageUrl', () => {
  it.each([
    ['http://192.168.1.10:8990', '/settings/general', 'http://192.168.1.10:8990/settings/general'],
    ['192.168.1.10:8990/', '/settings/general', 'http://192.168.1.10:8990/settings/general'],
    ['https://home.example/sonarr', '/settings/general', 'https://home.example/sonarr/settings/general'],
    ['http://192.168.1.10:8096', '/web/#/dashboard/keys', 'http://192.168.1.10:8096/web/#/dashboard/keys'],
    // A query, fragment or password typed with the address stays out of the link.
    ['http://h:8096/#/home', '/web/#/dashboard/keys', 'http://h:8096/web/#/dashboard/keys'],
    ['http://h:8989/?a=1', '/settings/general', 'http://h:8989/settings/general'],
    ['http://user:secret@h:8989', '/settings/general', 'http://h:8989/settings/general'],
    // An address copied from inside the app is not doubled.
    ['http://h:8989/settings/general', '/settings/general', 'http://h:8989/settings/general'],
    ['http://h:8096/web/', '/web/#/dashboard/keys', 'http://h:8096/web/#/dashboard/keys'],
    ['http://h:8096/web/index.html', '/web/#/dashboard/keys', 'http://h:8096/web/#/dashboard/keys'],
    ['https://home.example/jellyfin/web', '/web/#/dashboard/keys', 'https://home.example/jellyfin/web/#/dashboard/keys'],
  ])('opens %s + %s', (url, path, expected) => {
    expect(servicePageUrl(url, path)).toBe(expected);
  });

  it.each([['', '/settings/general'], ['javascript:alert(1)', '/x'], ['ftp://host', '/x'], ['http://host:8989', null], ['http://host.docker.internal:8989', '/settings/general']])(
    'offers no link for %j',
    (url, path) => {
      expect(servicePageUrl(url, path)).toBeNull();
    },
  );
});

describe('service form help', () => {
  it('links TMDB to its own settings page, whatever the typed address', () => {
    const tmdb = SERVICE_CONFIG.find((c) => c.type === 'TMDB')!;
    expect(tmdb.keyHelp.href).toBe('https://www.themoviedb.org/settings/api');
    expect(tmdb.keyHelp.path).toBeNull();
  });

  it.each(SERVICE_CONFIG.map((c) => [c.type, c] as const))('%s says where its key is', (_type, config) => {
    expect(config.keyHelp.where.length).toBeGreaterThan(5);
    if (config.keyHelp.path) expect(config.keyHelp.path).toMatch(/^\//);
    if (config.keyHelp.href) expect(config.keyHelp.href).toMatch(/^https:\/\//);
  });

  it.each(SERVICE_CONFIG.map((c) => [c.type, c.placeholder] as const))('%s placeholder is not localhost', (_type, placeholder) => {
    expect(placeholder).not.toMatch(/localhost|127\.0\.0\.1/);
  });
});
