import { describe, expect, it } from 'vitest';
import type { TorrentTracker } from '@/lib/qbittorrent-client';
import { magnetForViewer, seesTrackerUrls, trackerOrigin, trackersForViewer } from '@/lib/qbittorrent-tracker-links';

const KEY = '0123456789abcdef0123456789abcdef';
const tracker = (url: string, msg = ''): TorrentTracker => ({
  url, status: 2, tier: 0, num_peers: 3, num_seeds: 4, num_leeches: 1, num_downloaded: 9, msg,
});

describe('seesTrackerUrls', () => {
  it('is an admin only', () => {
    expect(seesTrackerUrls({ role: 'admin' })).toBe(true);
    expect(seesTrackerUrls({ role: 'member' })).toBe(false);
  });
});

describe('trackerOrigin', () => {
  it.each([
    [`https://tracker.invalid/announce/${KEY}`, 'https://tracker.invalid'],
    [`https://tracker.invalid/${KEY}/announce`, 'https://tracker.invalid'],
    ['http://t.invalid/a?passkey=deadbeef', 'http://t.invalid'],
    ['https://t.invalid:8443/announce.php?pk=deadbeefcafe', 'https://t.invalid:8443'],
    ['udp://tracker.invalid:6969/announce', 'udp://tracker.invalid:6969'],
    ['wss://tracker.invalid/announce?torrent_pass=feedface', 'wss://tracker.invalid'],
    ['https://user:secret@tracker.invalid/announce', 'https://tracker.invalid'],
    ['http://[2001:db8::1]:8080/announce/abc', 'http://[2001:db8::1]:8080'],
  ])('%s → %s', (url, origin) => {
    expect(trackerOrigin(url)).toBe(origin);
  });

  it('is null for something that is not a URL', () => {
    expect(trackerOrigin('not a url')).toBeNull();
    expect(trackerOrigin('** [DHT] **')).toBeNull();
  });
});

describe('trackersForViewer', () => {
  const list = [
    tracker('** [DHT] **'),
    tracker('** [PeX] **'),
    tracker('** [LSD] **'),
    tracker(`https://tracker.invalid/announce/${KEY}`, `Invalid passkey ${KEY}`),
    tracker('http://t.invalid/a?passkey=deadbeef', 'Unregistered torrent, see http://t.invalid/a?passkey=deadbeef'),
    tracker('https://pk.invalid/announce?pk=c0ffee1234', 'auth failed for pk=c0ffee1234'),
    tracker(`udp://open.invalid:6969/${KEY.toUpperCase()}/announce`),
    tracker('not a url', ''),
  ];

  it('gives an admin the list unchanged', () => {
    expect(trackersForViewer(list, true)).toBe(list);
  });

  it('gives anyone else hosts, state and a message without the key', () => {
    const shown = trackersForViewer(list, false);
    expect(shown.map((entry) => entry.url)).toEqual([
      '** [DHT] **',
      '** [PeX] **',
      '** [LSD] **',
      'https://tracker.invalid',
      'http://t.invalid',
      'https://pk.invalid',
      'udp://open.invalid:6969',
      'Tracker',
    ]);
    expect(shown[3]).toEqual({ url: 'https://tracker.invalid', status: 2, tier: 0, num_peers: 3, num_seeds: 4, num_leeches: 1, num_downloaded: 9, msg: 'Invalid passkey [REDACTED]' });
    expect(shown[4].msg).toBe('Unregistered torrent, see http://t.invalid');
    expect(shown[5].msg).not.toContain('c0ffee1234');
    const json = JSON.stringify(shown);
    for (const secret of [KEY, KEY.toUpperCase(), 'deadbeef', 'c0ffee1234', '/announce']) {
      expect(json).not.toContain(secret);
    }
  });

  it('keeps a message that holds no key as qBittorrent wrote it', () => {
    expect(trackersForViewer([tracker('udp://open.invalid:1337/announce', 'Connection timed out')], false)[0].msg).toBe('Connection timed out');
  });

  it('does not pass on fields qBittorrent adds', () => {
    const extra = { ...tracker(`https://tracker.invalid/announce/${KEY}`), endpoints: [{ name: `https://tracker.invalid/announce/${KEY}` }] } as TorrentTracker;
    expect(JSON.stringify(trackersForViewer([extra], false))).not.toContain(KEY);
  });
});

describe('magnetForViewer', () => {
  const magnet = 'magnet:?xt=urn:btih:aaaabbbbccccddddeeeeffff0000111122223333&xt=urn:btmh:1220abcd&dn=Some.Show.S01'
    + `&tr=https%3A%2F%2Ftracker.invalid%2Fannounce%2F${KEY}&tr=http%3A%2F%2Ft.invalid%2Fa%3Fpasskey%3Ddeadbeef&ws=https%3A%2F%2Fseed.invalid%2F${KEY}`;

  it("gives an admin qBittorrent's magnet", () => {
    expect(magnetForViewer(magnet, true)).toBe(magnet);
  });

  it('gives anyone else the info hashes and name only', () => {
    expect(magnetForViewer(magnet, false)).toBe('magnet:?xt=urn:btih:aaaabbbbccccddddeeeeffff0000111122223333&xt=urn:btmh:1220abcd&dn=Some.Show.S01');
  });

  it('is null without a magnet, or without an info hash to keep', () => {
    expect(magnetForViewer(undefined, false)).toBeNull();
    expect(magnetForViewer('', true)).toBeNull();
    expect(magnetForViewer('https://tracker.invalid/x.torrent', true)).toBeNull();
    expect(magnetForViewer(`magnet:?tr=https%3A%2F%2Ftracker.invalid%2F${KEY}`, false)).toBeNull();
  });
});
