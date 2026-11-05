import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QBittorrentClient, QBittorrentLoginError } from '@/lib/qbittorrent-client';
import { NotServiceApiError } from '@/lib/service-response';

// What answers POST /api/v2/auth/login decides the error: qBittorrent's "Fails." is a
// wrong password; a page with no session is something that is not qBittorrent.
describe('qBittorrent sign-in', () => {
  let answer = 'Fails.';
  let server: http.Server;
  let url = '';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      req.resume();
      if (req.url === '/api/v2/auth/login') {
        const headers: http.OutgoingHttpHeaders = { 'content-type': 'text/plain' };
        if (answer === 'Ok.') headers['set-cookie'] = 'SID=abc; HttpOnly; path=/';
        res.writeHead(200, headers);
        return res.end(answer);
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('v5.1.2');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('reads "Fails." as a refused username or password', async () => {
    answer = 'Fails.';
    await expect(new QBittorrentClient(url, 'wrong', 'admin').getVersion()).rejects.toBeInstanceOf(QBittorrentLoginError);
  });

  it('reads a page with no session as not qBittorrent', async () => {
    answer = '<!doctype html><title>Sign in</title>';
    await expect(new QBittorrentClient(url, 'any', 'admin').getVersion()).rejects.toBeInstanceOf(NotServiceApiError);
  });

  it('signs in when qBittorrent sets a session', async () => {
    answer = 'Ok.';
    await expect(new QBittorrentClient(url, 'right', 'admin').getVersion()).resolves.toBe('v5.1.2');
  });
});
