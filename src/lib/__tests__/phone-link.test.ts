import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { phoneLinkKind, qrModules } from '@/lib/phone-link';

// Renders the modules as a phone camera would see them (with the quiet zone the page
// draws around the code) and reads them back with a real decoder.
function decode(modules: boolean[][]): string | null {
  const scale = 4;
  const quiet = 4;
  const size = (modules.length + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const offset = (((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx) * 4;
          pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
        }
      }
    }),
  );
  return jsQR(pixels, size, size)?.data ?? null;
}

describe('qrModules', () => {
  it.each([
    'http://192.168.1.10:3050',
    'https://helprr.example.com',
    'http://[fd00::1234]:3050',
    'https://helprr.tail1234.ts.net',
    'http://nas.local:3050',
  ])('reads back %s', (origin) => {
    const modules = qrModules(origin);
    expect(modules.length).toBe(modules[0].length);
    expect(decode(modules)).toBe(origin);
  });
});

describe('phoneLinkKind', () => {
  it.each([
    ['http://localhost:3050', 'loopback'],
    ['http://127.0.0.1:3050', 'loopback'],
    ['http://[::1]:3050', 'loopback'],
    ['http://helprr.localhost:3050', 'loopback'],
    ['http://192.168.1.10:3050', 'local'],
    ['http://nas.local:3050', 'local'],
    ['http://helprr.example.com', 'local'],
    ['https://nas.lan', 'local'],
    ['https://[fd00::1]', 'local'],
    ['https://helprr.example.com', 'public'],
    ['https://helprr.tail1234.ts.net', 'public'],
  ])('%s is %s', (origin, kind) => {
    expect(phoneLinkKind(origin)).toBe(kind);
  });
});
