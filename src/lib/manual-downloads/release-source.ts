import { createHash } from 'crypto';

/**
 * Reading a hand-supplied magnet link or .torrent file for a manual download.
 *
 * Only what Arr needs to follow the download is taken: the v1 info hash (Arr's
 * downloadId, uppercase hex) and the release name (the default title pushed to
 * Arr, which Arr parses). Helprr does no title parsing of its own.
 */

export class ReleaseSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseSourceError';
  }
}

export interface MagnetSource {
  kind: 'MAGNET';
  infoHash: string;
  /** The magnet's display name (dn), or '' when it has none. */
  name: string;
  magnetUrl: string;
}

export interface TorrentFileSource {
  kind: 'TORRENT_FILE';
  infoHash: string;
  name: string;
  private: boolean;
  bytes: Buffer;
}

export type ReleaseSource = MagnetSource | TorrentFileSource;

/** Largest .torrent accepted; real ones are kilobytes to a few megabytes. */
export const MAX_TORRENT_BYTES = 10 * 1024 * 1024;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32ToHex(value: string): string | null {
  let bits = '';
  for (const char of value.toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) return null;
    bits += index.toString(2).padStart(5, '0');
  }
  if (bits.length !== 160) return null;
  return BigInt(`0b${bits}`).toString(16).padStart(40, '0');
}

/** Parse a magnet link; throws ReleaseSourceError when it has no usable v1 info hash. */
export function parseMagnet(link: string): MagnetSource {
  const trimmed = link.trim();
  if (!/^magnet:\?/i.test(trimmed)) throw new ReleaseSourceError('Not a magnet link.');
  const params = new URLSearchParams(trimmed.slice(trimmed.indexOf('?') + 1));
  let infoHash: string | null = null;
  for (const xt of params.getAll('xt')) {
    const match = /^urn:btih:([0-9a-z]+)$/i.exec(xt.trim());
    if (!match) continue;
    const value = match[1];
    if (/^[0-9a-f]{40}$/i.test(value)) infoHash = value;
    else if (value.length === 32) infoHash = base32ToHex(value);
    if (infoHash) break;
  }
  if (!infoHash) {
    throw new ReleaseSourceError(
      params.getAll('xt').some((xt) => /^urn:btmh:/i.test(xt))
        ? 'This magnet has only a BitTorrent v2 hash, which Sonarr and Radarr cannot follow.'
        : 'This magnet has no BitTorrent info hash (xt=urn:btih:…).',
    );
  }
  return { kind: 'MAGNET', infoHash: infoHash.toUpperCase(), name: (params.get('dn') ?? '').trim(), magnetUrl: trimmed };
}

type Bencoded = number | Buffer | Bencoded[] | { [key: string]: Bencoded };

/** A minimal bencode reader that also reports where each top-level dictionary value sits. */
function decode(bytes: Buffer): { value: Bencoded; spans: Map<string, [number, number]> } {
  let pos = 0;
  const spans = new Map<string, [number, number]>();
  const fail = (): never => { throw new ReleaseSourceError('This is not a valid .torrent file.'); };
  const readValue = (depth: number): Bencoded => {
    if (depth > 64 || pos >= bytes.length) fail();
    const byte = bytes[pos];
    if (byte === 0x69) { // i<number>e
      const end = bytes.indexOf(0x65, pos);
      if (end < 0) fail();
      const text = bytes.subarray(pos + 1, end).toString('ascii');
      if (!/^-?\d+$/.test(text)) fail();
      pos = end + 1;
      return Number(text);
    }
    if (byte === 0x6c) { // l…e
      pos += 1;
      const list: Bencoded[] = [];
      while (bytes[pos] !== 0x65) list.push(readValue(depth + 1));
      pos += 1;
      return list;
    }
    if (byte === 0x64) { // d…e
      pos += 1;
      const dict: { [key: string]: Bencoded } = {};
      while (bytes[pos] !== 0x65) {
        const key = readValue(depth + 1);
        if (!Buffer.isBuffer(key)) fail();
        const name = (key as Buffer).toString('latin1');
        const start = pos;
        dict[name] = readValue(depth + 1);
        if (depth === 0) spans.set(name, [start, pos]);
      }
      pos += 1;
      return dict;
    }
    if (byte >= 0x30 && byte <= 0x39) { // <length>:<bytes>
      const colon = bytes.indexOf(0x3a, pos);
      if (colon < 0) fail();
      const length = Number(bytes.subarray(pos, colon).toString('ascii'));
      if (!Number.isSafeInteger(length) || length < 0 || colon + 1 + length > bytes.length) fail();
      pos = colon + 1 + length;
      return bytes.subarray(colon + 1, pos);
    }
    return fail();
  };
  const value = readValue(0);
  if (pos !== bytes.length) fail();
  return { value, spans };
}

/** Read a .torrent file's v1 info hash and name; throws ReleaseSourceError when it is unusable. */
export function parseTorrentFile(bytes: Buffer): TorrentFileSource {
  if (bytes.length === 0 || bytes.length > MAX_TORRENT_BYTES) throw new ReleaseSourceError('This is not a valid .torrent file.');
  const { value, spans } = decode(bytes);
  const span = spans.get('info');
  const info = value && typeof value === 'object' && !Buffer.isBuffer(value) && !Array.isArray(value) ? value.info : undefined;
  if (!span || !info || typeof info !== 'object' || Buffer.isBuffer(info) || Array.isArray(info)) {
    throw new ReleaseSourceError('This .torrent file has no info section.');
  }
  // A v2-only torrent has no v1 pieces, so there is no v1 hash for Arr to follow.
  if (!Buffer.isBuffer(info.pieces)) {
    throw new ReleaseSourceError('This .torrent is BitTorrent v2 only, which Sonarr and Radarr cannot follow.');
  }
  const name = Buffer.isBuffer(info['name.utf-8']) ? info['name.utf-8'] : info.name;
  return {
    kind: 'TORRENT_FILE',
    infoHash: createHash('sha1').update(bytes.subarray(span[0], span[1])).digest('hex').toUpperCase(),
    name: Buffer.isBuffer(name) ? name.toString('utf8').trim() : '',
    private: info.private === 1,
    bytes,
  };
}
