import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { QBittorrentClient } from '@/lib/qbittorrent-client';
import { QBittorrentSync } from '@/lib/qbittorrent-sync';

/*
 * The merged sync/maindata state through the real client, against a stand-in
 * qBittorrent that keeps one rid per session as 5.1.4 does: a known session
 * sending its last rid gets the changes, anything else a full update. A restart
 * forgets every session; with sign-in required it answers 403, with "bypass
 * authentication" it quietly opens a new session and sets its cookie.
 */
describe('QBittorrentSync through QBittorrentClient', () => {
  let server: http.Server;
  let sessions: Map<string, number>;
  let nextSid: number;
  let bypass: boolean;
  let seen: Array<{ sid: string | undefined; rid: string | null; full: boolean }>;
  let names: Record<string, string>;

  function newSession(res: http.ServerResponse) {
    const sid = `s${nextSid++}`;
    sessions.set(sid, 0);
    res.setHeader('set-cookie', `SID=${sid}; HttpOnly; path=/`);
    return sid;
  }

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url!, 'http://x');
      let sid = /SID=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
      if (url.pathname === '/api/v2/auth/login') {
        newSession(res);
        return res.end('Ok.');
      }
      if (!sid || !sessions.has(sid)) {
        if (!bypass) {
          res.writeHead(403);
          return res.end('Forbidden');
        }
        sid = newSession(res);
      }
      const last = sessions.get(sid)!;
      const rid = url.searchParams.get('rid');
      const full = rid === '0' || Number(rid) !== last;
      sessions.set(sid, last + 1);
      seen.push({ sid, rid, full });
      const torrents = Object.fromEntries(Object.entries(names).map(([hash, name]) => [hash, { name }]));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(full ? { rid: last + 1, full_update: true, torrents, server_state: {} } : { rid: last + 1 }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    sessions = new Map();
    nextSid = 1;
    seen = [];
    names = { aaa: 'Alpha' };
  });

  const restart = () => sessions.clear();

  it.each([
    ['sign-in required (403, then a new sign-in)', false],
    ['bypass authentication (a new cookie, no 403)', true],
  ])('after a qBittorrent restart with %s, one full read, then incremental again', async (_label, withBypass) => {
    bypass = withBypass;
    const client = new QBittorrentClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'pw', 'admin');
    const sync = new QBittorrentSync(client);
    await sync.read(0);
    await sync.read(0);
    restart();
    names = { bbb: 'Bravo' };
    expect((await sync.read(0)).torrents.map((t) => t.name)).toEqual(['Bravo']);
    await sync.read(0);
    await sync.read(0);
    // Before the fix a bypassed qBittorrent was asked with the stale cookie every
    // time, so every read opened a session and came back in full.
    expect(seen.map((s) => s.full)).toEqual([true, false, true, false, false]);
    const afterRestart = seen.slice(2).map((s) => s.sid);
    expect(new Set(afterRestart).size).toBe(1);
    expect(afterRestart[0]).not.toBe(seen[0].sid);
  });
});
