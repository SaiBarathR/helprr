import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isRefusedRedirect, refuseRedirectToAnotherHost } from '@/lib/redirect-guard';
import { SonarrClient } from '@/lib/sonarr-client';
import { JellyfinClient } from '@/lib/jellyfin-client';

/**
 * A service that answers with a redirect to another host must not be handed
 * the credentials meant for it there. The HTTP client drops `Authorization`
 * and `Cookie` on such a redirect but not `X-Api-Key`, custom headers, or the
 * body of a 307, so the redirect is refused outright.
 *
 * Real servers and the real axios stack: this is about what goes on the wire.
 */

describe('refuseRedirectToAnotherHost', () => {
  const follow = (from: string, to: string) => () => refuseRedirectToAnotherHost({ href: to }, {}, { url: from });

  it.each([
    ['another path on the same host', 'http://sonarr.lan:8989/a', 'http://sonarr.lan:8989/sonarr/a'],
    ['an upgrade to https on the same host', 'http://sonarr.example.com/a', 'https://sonarr.example.com/a'],
    ['an upgrade to https on the same port', 'http://sonarr.lan:8989/a', 'https://sonarr.lan:8989/a'],
    ['a default port written out', 'https://sonarr.example.com:443/a', 'https://sonarr.example.com/b'],
  ])('follows %s', (_label, from, to) => {
    expect(follow(from, to)).not.toThrow();
  });

  it.each([
    ['another host', 'http://sonarr.lan:8989/a', 'http://collector.example/a'],
    ['another port', 'http://sonarr.lan:8989/a', 'http://sonarr.lan:9000/a'],
    ['a subdomain', 'https://example.com/a', 'https://sonarr.example.com/a'],
    ['a parent domain', 'https://sonarr.example.com/a', 'https://example.com/a'],
    ['a downgrade to http', 'https://sonarr.example.com/a', 'http://sonarr.example.com/a'],
    ['the https port of a host reached on another', 'http://sonarr.lan:8989/a', 'https://sonarr.lan/a'],
    ['an address that cannot be read', 'http://sonarr.lan:8989/a', 'not a url'],
  ])('refuses %s', (_label, from, to) => {
    expect(follow(from, to)).toThrow(/Refusing to follow a redirect/);
  });
});

describe('a service client that is redirected', () => {
  type Seen = { path: string; apiKey?: string; custom?: string; body: string };
  let elsewhere: http.Server;
  let service: http.Server;
  let seenElsewhere: Seen[];
  let seenByService: Seen[];
  let redirectTo: (path: string) => string;

  const listen = (server: http.Server, host: string) =>
    new Promise<number>((resolve) => server.listen(0, host, () => resolve((server.address() as AddressInfo).port)));
  const record = (into: Seen[]) => (req: http.IncomingMessage, done: (seen: Seen) => void) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const seen = { path: req.url ?? '', apiKey: req.headers['x-api-key'] as string | undefined, custom: req.headers['cf-access-client-secret'] as string | undefined, body };
      into.push(seen);
      done(seen);
    });
  };

  let serviceUrl: string;
  beforeEach(async () => {
    seenElsewhere = [];
    seenByService = [];
    elsewhere = http.createServer((req, res) => record(seenElsewhere)(req, () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"version":"elsewhere"}'); }));
    // `localhost` and `127.0.0.1` reach the same machine and are different hosts.
    const elsewherePort = await listen(elsewhere, '127.0.0.1');
    service = http.createServer((req, res) => record(seenByService)(req, (seen) => {
      if (seen.path.startsWith('/moved')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"version":"4.0.0"}');
        return;
      }
      res.writeHead(307, { Location: redirectTo(seen.path) });
      res.end();
    }));
    const servicePort = await listen(service, '127.0.0.1');
    serviceUrl = `http://127.0.0.1:${servicePort}`;
    redirectTo = (path) => `http://localhost:${elsewherePort}${path}`;
  });
  afterEach(async () => {
    await Promise.all([elsewhere, service].map((server) => new Promise((resolve) => server.close(resolve))));
  });

  it('does not take its API key or custom headers to another host', async () => {
    const client = new SonarrClient(serviceUrl, 'the-real-api-key', { 'CF-Access-Client-Secret': 'proxy-secret' });

    const failure = await client.getSystemStatus().catch((error: unknown) => error);
    expect(String((failure as Error).message)).toMatch(/Refusing to follow a redirect/);
    // Routes use this to tell a person what happened; the client wraps the cause twice.
    expect(isRefusedRedirect(failure)).toBe(true);
    expect(isRefusedRedirect(new Error('socket hang up'))).toBe(false);

    expect(seenByService).toHaveLength(1);
    expect(seenByService[0].apiKey).toBe('the-real-api-key');
    expect(seenElsewhere).toEqual([]);
  });

  it('still follows a redirect on the same host, credentials included', async () => {
    redirectTo = (path) => `/moved${path}`;
    const client = new SonarrClient(serviceUrl, 'the-real-api-key', { 'CF-Access-Client-Secret': 'proxy-secret' });

    await expect(client.getSystemStatus()).resolves.toEqual({ version: '4.0.0' });

    expect(seenByService.map((seen) => seen.path)).toEqual(['/api/v3/system/status', '/moved/api/v3/system/status']);
    expect(seenByService[1]).toMatchObject({ apiKey: 'the-real-api-key', custom: 'proxy-secret' });
  });

  // A 307 resends the request body, and a sign-in's body is the password.
  it('does not resend a sign-in to another host', async () => {
    const result = await JellyfinClient.authenticateByName(serviceUrl, 'member', 'the-members-password');

    expect(result).toEqual({ ok: false, reason: 'unavailable' });
    expect(seenByService).toHaveLength(1);
    expect(seenByService[0].body).toContain('the-members-password');
    expect(seenElsewhere).toEqual([]);
  });
});
