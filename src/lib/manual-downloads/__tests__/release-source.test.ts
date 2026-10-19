import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import { parseMagnet, parseTorrentFile, ReleaseSourceError } from '../release-source';

const HEX = '382cc016ff22946008ecddcb0dda820f42b0cd5a';
// The same 20 bytes in base32.
const B32 = 'HAWMAFX7EKKGACHM3XFQ3WUCB5BLBTK2';

function bencode(value: unknown): Buffer {
  if (typeof value === 'number') return Buffer.from(`i${value}e`);
  if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  if (typeof value === 'string') return bencode(Buffer.from(value));
  if (Array.isArray(value)) return Buffer.concat([Buffer.from('l'), ...value.map(bencode), Buffer.from('e')]);
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
  return Buffer.concat([Buffer.from('d'), ...entries.flatMap(([k, v]) => [bencode(k), bencode(v)]), Buffer.from('e')]);
}

describe('parseMagnet', () => {
  it('reads a hex info hash and the display name', () => {
    const magnet = parseMagnet(`magnet:?xt=urn:btih:${HEX}&dn=Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP&tr=udp%3A%2F%2Ftracker.example%3A80`);
    expect(magnet).toEqual(expect.objectContaining({ kind: 'MAGNET', infoHash: HEX.toUpperCase(), name: 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP' }));
  });

  it('reads a base32 info hash as the same hex hash', () => {
    expect(parseMagnet(`magnet:?xt=urn:btih:${B32}`).infoHash).toBe(HEX.toUpperCase());
  });

  it('accepts a magnet with no display name', () => {
    expect(parseMagnet(`magnet:?xt=urn:btih:${HEX}`).name).toBe('');
  });

  it('refuses a magnet that names two torrents, and accepts a v1/v2 hybrid', () => {
    const other = 'a'.repeat(40);
    expect(() => parseMagnet(`magnet:?xt=urn:btih:${HEX}&xt=urn:btih:${other}`)).toThrow('more than one torrent');
    expect(parseMagnet(`magnet:?xt=urn:btih:${HEX}&xt=urn:btih:${B32}`).infoHash).toBe(HEX.toUpperCase());
    expect(parseMagnet(`magnet:?xt=urn:btih:${HEX}&xt=urn:btmh:1220abcd`).infoHash).toBe(HEX.toUpperCase());
  });

  it('refuses what Arr cannot follow', () => {
    expect(() => parseMagnet('https://example.com/file.torrent')).toThrow(ReleaseSourceError);
    expect(() => parseMagnet('magnet:?dn=no-hash')).toThrow('no BitTorrent info hash');
    expect(() => parseMagnet('magnet:?xt=urn:btmh:1220abcd')).toThrow('v2 hash');
    expect(() => parseMagnet('magnet:?xt=urn:btih:nothex')).toThrow(ReleaseSourceError);
  });
});

describe('parseTorrentFile', () => {
  const info = { length: 262144, name: 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP.mkv', 'piece length': 16384, pieces: Buffer.alloc(20 * 16, 7), private: 1 };

  it('hashes the exact bytes of the info dictionary and reads the name', () => {
    const file = bencode({ announce: 'http://127.0.0.1:1/announce', 'creation date': 1700000000, info });
    const torrent = parseTorrentFile(file);
    expect(torrent.infoHash).toBe(createHash('sha1').update(bencode(info)).digest('hex').toUpperCase());
    expect(torrent).toEqual(expect.objectContaining({ kind: 'TORRENT_FILE', name: info.name, private: true }));
  });

  it('prefers the UTF-8 name when there is one', () => {
    const torrent = parseTorrentFile(bencode({ info: { ...info, 'name.utf-8': 'Café.1968.1080p.mkv' } }));
    expect(torrent.name).toBe('Café.1968.1080p.mkv');
  });

  it('refuses a v2-only torrent, a missing info section and broken files', () => {
    expect(() => parseTorrentFile(bencode({ info: { name: 'x', 'meta version': 2, 'file tree': {} } }))).toThrow('v2 only');
    expect(() => parseTorrentFile(bencode({ announce: 'x' }))).toThrow('no info section');
    expect(() => parseTorrentFile(Buffer.from('d4:info'))).toThrow(ReleaseSourceError);
    expect(() => parseTorrentFile(Buffer.from('not bencode'))).toThrow(ReleaseSourceError);
    expect(() => parseTorrentFile(Buffer.concat([bencode({ info }), Buffer.from('trailing')]))).toThrow(ReleaseSourceError);
  });

  it('accepts only canonical bencode numbers', () => {
    const good = bencode({ info });
    expect(() => parseTorrentFile(Buffer.from(good.toString('latin1').replace('4:info', '4e0:info'), 'latin1'))).toThrow(ReleaseSourceError);
    expect(() => parseTorrentFile(Buffer.from(good.toString('latin1').replace('4:info', '04:info'), 'latin1'))).toThrow(ReleaseSourceError);
    expect(() => parseTorrentFile(Buffer.from(good.toString('latin1').replace('i1e', 'i01e'), 'latin1'))).toThrow(ReleaseSourceError);
    expect(() => parseTorrentFile(Buffer.from(good.toString('latin1').replace('i1e', 'i-0e'), 'latin1'))).toThrow(ReleaseSourceError);
  });

  it('walks a huge list it does not need without building it', () => {
    const filler = Buffer.concat([Buffer.from('l'), Buffer.alloc(2_000_000, '0:'), Buffer.from('e')]);
    const file = Buffer.concat([Buffer.from('d7:comment'), filler, Buffer.from('4:info'), bencode(info), Buffer.from('e')]);
    const before = process.memoryUsage().heapUsed;
    const torrent = parseTorrentFile(file);
    expect(torrent.infoHash).toBe(createHash('sha1').update(bencode(info)).digest('hex').toUpperCase());
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(32 * 1024 * 1024);
  });
});
