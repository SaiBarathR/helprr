import { describe, expect, it } from 'vitest';
import { filenameFromDisposition, torrentExportDisposition, torrentExportFilename } from '@/lib/torrent-export-name';

const HASH = 'AAAABBBBCCCCDDDDEEEEFFFF0000111122223333';

describe('torrentExportFilename', () => {
  it.each([
    ['Ubuntu 24.04', 'Ubuntu 24.04.torrent'],
    ['../../etc/passwd', '_.._etc_passwd.torrent'],
    ['a\\b:c*d?e"f<g>h|i', 'a_b_c_d_e_f_g_h_i.torrent'],
    ['line\nbreak\u0000', 'line_break_.torrent'],
    ['  ...  ', `${HASH.toLowerCase()}.torrent`],
    [undefined, `${HASH.toLowerCase()}.torrent`],
  ])('makes %j safe to save', (name, expected) => {
    expect(torrentExportFilename(name, HASH)).toBe(expected);
  });

  it('keeps a long name to 150 characters, without splitting one', () => {
    const name = `${'😀'.repeat(149)}xyz`;
    expect(torrentExportFilename(name, HASH)).toBe(`${'😀'.repeat(149)}x.torrent`);
  });
});

describe('torrentExportDisposition and filenameFromDisposition', () => {
  it.each(['Ünïcödé – “quoted” (2024)', "O'Brien; 100%", 'plain'])('round-trips %j', (name) => {
    const header = torrentExportDisposition(name, HASH);
    expect(header).toMatch(/^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''[A-Za-z0-9%._~!-]+$/);
    expect(filenameFromDisposition(header, 'x')).toBe(`${name}.torrent`);
  });

  it('falls back to the plain name, then to the fallback', () => {
    expect(filenameFromDisposition('attachment; filename="a.torrent"', 'x')).toBe('a.torrent');
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%E0%A4%A", 'x')).toBe('x');
    expect(filenameFromDisposition(null, 'x')).toBe('x');
  });
});
