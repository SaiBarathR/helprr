export class MagnetParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MagnetParseError';
  }
}

const BTIH_HEX_RE = /^[a-fA-F0-9]{40}$/;
const BTIH_BASE32_RE = /^[A-Z2-7]{32}$/;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32ToHex(value: string): string {
  let buffer = 0;
  let bitsInBuffer = 0;
  const bytes: number[] = [];

  for (const char of value) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new MagnetParseError('Invalid base32 info hash in magnet link');
    }

    buffer = (buffer << 5) | index;
    bitsInBuffer += 5;

    while (bitsInBuffer >= 8) {
      bitsInBuffer -= 8;
      bytes.push((buffer >> bitsInBuffer) & 0xff);
      buffer &= (1 << bitsInBuffer) - 1;
    }
  }

  if (bitsInBuffer > 0 && buffer !== 0) {
    throw new MagnetParseError('Invalid base32 info hash in magnet link');
  }

  if (bytes.length !== 20) {
    throw new MagnetParseError('Invalid base32 info hash length in magnet link');
  }

  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function parseMagnetInfoHash(input: string): { normalizedHexHash: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new MagnetParseError('Magnet link is required');
  }

  if (!trimmed.startsWith('magnet:?')) {
    throw new MagnetParseError('Invalid magnet link format');
  }

  const query = trimmed.slice('magnet:?'.length);
  if (!query) {
    throw new MagnetParseError('Magnet link is missing query parameters');
  }

  const params = new URLSearchParams(query);
  const xtValues = params.getAll('xt');
  if (xtValues.length === 0) {
    throw new MagnetParseError('Magnet link is missing xt parameter');
  }

  let sawBtih = false;
  for (const xt of xtValues) {
    const match = /^urn:btih:([A-Za-z0-9]+)$/.exec(xt.trim());
    if (!match) continue;

    sawBtih = true;
    const rawHash = match[1];

    if (BTIH_HEX_RE.test(rawHash)) {
      return { normalizedHexHash: rawHash.toLowerCase() };
    }

    const base32Candidate = rawHash.toUpperCase();
    if (BTIH_BASE32_RE.test(base32Candidate)) {
      return { normalizedHexHash: decodeBase32ToHex(base32Candidate) };
    }

    throw new MagnetParseError('Invalid btih info hash in magnet link');
  }

  if (sawBtih) {
    throw new MagnetParseError('Invalid btih info hash in magnet link');
  }

  throw new MagnetParseError('Magnet link must include xt=urn:btih:<hash>');
}
