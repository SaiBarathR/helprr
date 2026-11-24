import { describe, expect, it } from 'vitest';
import { redactProwlarrHistoryRecord, redactProwlarrText } from '@/lib/prowlarr-redact';

// A private tracker's announce URL, percent-encoded the way Prowlarr writes a magnet's trackers.
const PASSKEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const PRIVATE_TR = `http%3a%2f%2fprivate.example%2f${PASSKEY}%2fannounce`;

describe('redactProwlarrText and magnets', () => {
  it('drops a whole magnet, its spaced name and every tracker with it', () => {
    const magnet = `magnet:?xt=urn:btih:1658902AEC7B&dn=Big Buck Bunny BDRip 360p&tr=${PRIVATE_TR}&tr=udp%3a%2f%2fopen.example%3a1337`;
    expect(redactProwlarrText(magnet)).toBe('magnet:[REDACTED]');
    expect(redactProwlarrText(`  ${magnet.toUpperCase()}`)).toBe('  magnet:[REDACTED]');
  });

  it('cuts a magnet inside other text to the end of its line, however its trackers are written', () => {
    const tails = [
      `&tr=${PRIVATE_TR}`,
      `&amp;tr=${PRIVATE_TR}`,
      `;tr=${PRIVATE_TR}`,
      `%26tr%3D${PRIVATE_TR}`,
    ];
    for (const tail of tails) {
      const text = redactProwlarrText(`Failed for magnet:?xt=urn:btih:ABC&dn=Big Buck Bunny${tail} timed out\nnext line`);
      expect(text, tail).toBe('Failed for magnet:[REDACTED]\nnext line');
    }
    expect(redactProwlarrText(`q=magnet%3A%3Fxt%3Durn%3Abtih%3AABC%26tr%3D${PRIVATE_TR}`)).toBe('q=magnet:[REDACTED]');
  });

  it('keeps the word magnet when no link follows it', () => {
    expect(redactProwlarrText('This client does not support magnet: links')).toBe('This client does not support magnet: links');
  });

  it('leaves text without a magnet as it was, and still cuts URLs to their origin', () => {
    expect(redactProwlarrText('Big Buck Bunny 1080p')).toBe('Big Buck Bunny 1080p');
    expect(redactProwlarrText(`https://private.example/${PASSKEY}/rss`)).toBe('https://private.example');
  });

  it('redacts a magnet grab in history the way Prowlarr records it', () => {
    const record = redactProwlarrHistoryRecord({
      id: 1,
      indexerId: 6,
      indexer: 'Knaben',
      query: '',
      queryType: 'search',
      categories: [],
      eventType: 'releaseGrabbed',
      successful: true,
      date: '2026-11-24T13:46:29Z',
      data: {
        url: `magnet:?xt=urn:btih:ABC&dn=Big Buck Bunny 2008&tr=${PRIVATE_TR}`,
        grabTitle: 'Big Buck Bunny 2008',
      },
    });

    expect(record.data).toEqual({ url: 'magnet:[REDACTED]', grabTitle: 'Big Buck Bunny 2008' });
  });
});
