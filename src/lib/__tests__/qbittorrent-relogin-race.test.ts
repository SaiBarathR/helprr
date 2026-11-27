import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QBittorrentClient } from '@/lib/qbittorrent-client';

// After qBittorrent restarts, two requests in flight both get 403 with the old
// session. The first signs in again; the second's late 403 must not drop that
// new session and sign in once more (the shared client has one session).
describe('qBittorrent re-sign-in after a restart', () => {
  let server: http.Server;
  let url = '';
  let logins = 0;
  const valid = new Set<string>();

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      req.resume();
      if (req.url === '/api/v2/auth/login') {
        const sid = `s${++logins}`;
        valid.add(sid);
        res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': `SID=${sid}; HttpOnly; path=/` });
        return res.end('Ok.');
      }
      const ok = valid.has(/SID=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? '');
      // The speed-mode answer is slow: its 403 lands after the other request signed in again.
      const delay = req.url === '/api/v2/transfer/speedLimitsMode' && !ok ? 150 : 0;
      setTimeout(() => {
        if (!ok) { res.writeHead(403); return res.end('Forbidden'); }
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(req.url === '/api/v2/transfer/speedLimitsMode' ? '1' : 'v5.1.4');
      }, delay);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('signs in once for both requests', async () => {
    const client = new QBittorrentClient(url, 'pw', 'admin');
    await client.getVersion();
    expect(logins).toBe(1);
    valid.clear(); // qBittorrent restarted: the session is gone.

    await expect(Promise.all([client.getSpeedLimitsMode(), client.getVersion()])).resolves.toEqual([1, 'v5.1.4']);
    expect(logins).toBe(2);
  });
});
