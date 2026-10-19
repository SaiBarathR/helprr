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
  // Every v1 hash it names: one torrent, so exactly one (a v2 btmh beside it is fine).
  const hashes = new Set<string>();
  for (const xt of params.getAll('xt')) {
    const match = /^urn:btih:([0-9a-z]+)$/i.exec(xt.trim());
    if (!match) continue;
    const value = match[1];
    const hex = /^[0-9a-f]{40}$/i.test(value) ? value : value.length === 32 ? base32ToHex(value) : null;
    if (hex) hashes.add(hex.toUpperCase());
  }
  if (hashes.size > 1) throw new ReleaseSourceError('This magnet names more than one torrent.');
  const infoHash = [...hashes][0] ?? null;
  if (!infoHash) {
    throw new ReleaseSourceError(
      params.getAll('xt').some((xt) => /^urn:btmh:/i.test(xt))
        ? 'This magnet has only a BitTorrent v2 hash, which Sonarr and Radarr cannot follow.'
        : 'This magnet has no BitTorrent info hash (xt=urn:btih:…).',
    );
  }
  return { kind: 'MAGNET', infoHash, name: (params.get('dn') ?? '').trim(), magnetUrl: trimmed };
}

const fail = (): never => { throw new ReleaseSourceError('This is not a valid .torrent file.'); };

/**
 * A strict, allocation-light bencode walker. It checks the whole file's syntax
 * (canonical integers and lengths only) but builds nothing it does not need:
 * from the top level only the `info` dictionary's byte span, and from `info`
 * only the few values read below. A hostile file cannot make it build millions
 * of values.
 */
class BencodeWalker {
  private pos = 0;
  constructor(private readonly bytes: Buffer) {}

  get position() { return this.pos; }
  get atEnd() { return this.pos === this.bytes.length; }

  private peek(): number {
    if (this.pos >= this.bytes.length) fail();
    return this.bytes[this.pos];
  }

  /** i<integer>e with no leading zeros and no -0. */
  readInteger(): number {
    if (this.peek() !== 0x69) fail();
    const end = this.bytes.indexOf(0x65, this.pos);
    if (end < 0) fail();
    const text = this.bytes.subarray(this.pos + 1, end).toString('latin1');
    if (!/^(0|-?[1-9]\d*)$/.test(text)) fail();
    this.pos = end + 1;
    return Number(text);
  }

  /** <length>:<bytes>, the length in plain decimal; a view, not a copy. */
  readString(): Buffer {
    const colon = this.bytes.indexOf(0x3a, this.pos);
    if (colon < 0) fail();
    const text = this.bytes.subarray(this.pos, colon).toString('latin1');
    if (!/^(0|[1-9]\d*)$/.test(text)) fail();
    const length = Number(text);
    if (!Number.isSafeInteger(length) || colon + 1 + length > this.bytes.length) fail();
    this.pos = colon + 1 + length;
    return this.bytes.subarray(colon + 1, this.pos);
  }

  /** Walk past one value of any kind, building nothing. */
  skip(depth = 0): void {
    if (depth > 64) fail();
    const byte = this.peek();
    if (byte === 0x69) { this.readInteger(); return; }
    if (byte >= 0x30 && byte <= 0x39) { this.readString(); return; }
    if (byte === 0x6c || byte === 0x64) {
      this.pos += 1;
      while (this.peek() !== 0x65) {
        if (byte === 0x64) this.readString(); // a dictionary key
        this.skip(depth + 1);
      }
      this.pos += 1;
      return;
    }
    fail();
  }

  /** Walk a dictionary, handing each key to `onKey`, which must consume its value. */
  dictionary(onKey: (key: string) => void): void {
    if (this.peek() !== 0x64) fail();
    this.pos += 1;
    while (this.peek() !== 0x65) onKey(this.readString().toString('latin1'));
    this.pos += 1;
  }
}

/** Read a .torrent file's v1 info hash and name; throws ReleaseSourceError when it is unusable. */
export function parseTorrentFile(bytes: Buffer): TorrentFileSource {
  if (bytes.length === 0 || bytes.length > MAX_TORRENT_BYTES) fail();
  const walker = new BencodeWalker(bytes);
  let span: [number, number] | null = null;
  let name: Buffer | null = null;
  let utf8Name: Buffer | null = null;
  let isPrivate = false;
  let hasPieces = false;
  walker.dictionary((key) => {
    if (key !== 'info' || span) { walker.skip(); return; }
    const start = walker.position;
    walker.dictionary((field) => {
      if (field === 'name') name = walker.readString();
      else if (field === 'name.utf-8') utf8Name = walker.readString();
      else if (field === 'private') isPrivate = walker.readInteger() === 1;
      else if (field === 'pieces') hasPieces = walker.readString().length > 0;
      else walker.skip(1);
    });
    span = [start, walker.position];
  });
  if (!walker.atEnd) fail();
  if (!span) throw new ReleaseSourceError('This .torrent file has no info section.');
  // A v2-only torrent has no v1 pieces, so there is no v1 hash for Arr to follow.
  if (!hasPieces) throw new ReleaseSourceError('This .torrent is BitTorrent v2 only, which Sonarr and Radarr cannot follow.');
  const [from, to] = span as [number, number];
  const shown = (utf8Name ?? name) as Buffer | null;
  return {
    kind: 'TORRENT_FILE',
    infoHash: createHash('sha1').update(bytes.subarray(from, to)).digest('hex').toUpperCase(),
    name: shown ? shown.toString('utf8').trim() : '',
    private: isPrivate,
    bytes,
  };
}
