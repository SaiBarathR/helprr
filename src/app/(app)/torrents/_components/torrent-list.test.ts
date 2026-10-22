import { describe, expect, it } from 'vitest';
import { formatBytes, formatSpeed } from './torrent-list';

describe('formatBytes', () => {
  it('shows an unknown size as "—", as qBittorrent reports -1 while it fetches metadata', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });

  it('formats known sizes as before', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatSpeed(1048576)).toBe('1 MB/s');
    expect(formatBytes(0.5)).toBe('0.5 B');
    expect(formatBytes(1024 ** 5)).toBe('1024 TB');
  });
});
