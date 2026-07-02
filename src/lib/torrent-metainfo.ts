import { createHash } from 'crypto';

export class TorrentParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TorrentParseError';
  }
}

type BencodeValue = number | Uint8Array | BencodeValue[] | BencodeDict;
interface BencodeDict {
  [key: string]: BencodeValue;
}

const MAX_DEPTH = 64;

function fail(message: string): never {
  throw new TorrentParseError(message);
}

function asciiSlice(buf: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i++) out += String.fromCharCode(buf[i]);
  return out;
}

function decodeString(buf: Uint8Array, pos: number): { bytes: Uint8Array; end: number } {
  let colon = pos;
  while (colon < buf.length && buf[colon] !== 0x3a /* : */) {
    if (buf[colon] < 0x30 || buf[colon] > 0x39) fail('Invalid string length in torrent file');
    colon++;
  }
  if (colon === pos || colon >= buf.length) fail('Invalid string in torrent file');
  const length = Number(asciiSlice(buf, pos, colon));
  if (!Number.isSafeInteger(length) || length < 0) fail('Invalid string length in torrent file');
  const start = colon + 1;
  const end = start + length;
  if (end > buf.length) fail('Truncated string in torrent file');
  return { bytes: buf.subarray(start, end), end };
}

// Dictionary keys need string form; values (e.g. multi-MB `pieces`) stay as bytes.
function decodeKey(buf: Uint8Array, pos: number): { text: string; end: number } {
  const { bytes, end } = decodeString(buf, pos);
  return { text: asciiSlice(bytes, 0, bytes.length), end };
}

function decodeValue(buf: Uint8Array, pos: number, depth: number): { value: BencodeValue; end: number } {
  if (depth > MAX_DEPTH) fail('Torrent file is nested too deeply');
  const byte = buf[pos];
  if (byte === undefined) fail('Unexpected end of torrent file');

  if (byte === 0x69 /* i */) {
    let end = pos + 1;
    while (end < buf.length && buf[end] !== 0x65 /* e */) end++;
    if (end >= buf.length) fail('Unterminated integer in torrent file');
    const num = Number(asciiSlice(buf, pos + 1, end));
    if (!Number.isFinite(num)) fail('Invalid integer in torrent file');
    return { value: num, end: end + 1 };
  }

  if (byte === 0x6c /* l */) {
    const items: BencodeValue[] = [];
    let cur = pos + 1;
    while (cur < buf.length && buf[cur] !== 0x65 /* e */) {
      const item = decodeValue(buf, cur, depth + 1);
      items.push(item.value);
      cur = item.end;
    }
    if (cur >= buf.length) fail('Unterminated list in torrent file');
    return { value: items, end: cur + 1 };
  }

  if (byte === 0x64 /* d */) {
    const dict: BencodeDict = {};
    let cur = pos + 1;
    while (cur < buf.length && buf[cur] !== 0x65 /* e */) {
      const key = decodeKey(buf, cur);
      const val = decodeValue(buf, key.end, depth + 1);
      dict[key.text] = val.value;
      cur = val.end;
    }
    if (cur >= buf.length) fail('Unterminated dictionary in torrent file');
    return { value: dict, end: cur + 1 };
  }

  if (byte >= 0x30 && byte <= 0x39) {
    const str = decodeString(buf, pos);
    return { value: str.bytes, end: str.end };
  }

  fail('Invalid bencode data in torrent file');
}

/**
 * Computes the torrent hash qBittorrent reports for a .torrent file: the SHA-1
 * of the bencoded info dictionary (v1 / hybrid), or the SHA-256 truncated to
 * 40 hex chars for v2-only torrents.
 */
export function parseTorrentInfoHash(buffer: Uint8Array): string {
  if (buffer.length === 0 || buffer[0] !== 0x64 /* d */) {
    fail('Torrent file must start with a bencoded dictionary');
  }

  let cur = 1;
  while (cur < buffer.length && buffer[cur] !== 0x65 /* e */) {
    const key = decodeKey(buffer, cur);
    const valueStart = key.end;
    const result = decodeValue(buffer, valueStart, 0);

    if (key.text === 'info') {
      const info = result.value;
      if (info === null || typeof info !== 'object' || Array.isArray(info) || info instanceof Uint8Array) {
        fail('Torrent info entry must be a dictionary');
      }
      const infoDict = info as BencodeDict;
      const v2Only =
        infoDict['meta version'] === 2 &&
        infoDict['files'] === undefined &&
        infoDict['length'] === undefined;
      const span = buffer.subarray(valueStart, result.end);
      return createHash(v2Only ? 'sha256' : 'sha1').update(span).digest('hex').slice(0, 40);
    }

    cur = result.end;
  }

  fail('Torrent file has no info dictionary');
}
