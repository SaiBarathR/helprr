import { describe, expect, it } from 'vitest';
import { formatDownloadProtocol } from '@/lib/format';

describe('formatDownloadProtocol', () => {
  it('names the *arr history enum numbers', () => {
    expect(formatDownloadProtocol('2')).toBe('Torrent');
    expect(formatDownloadProtocol('1')).toBe('Usenet');
    expect(formatDownloadProtocol(2)).toBe('Torrent');
  });

  it('capitalizes a protocol that already comes as a name', () => {
    expect(formatDownloadProtocol('torrent')).toBe('Torrent');
    expect(formatDownloadProtocol('usenet')).toBe('Usenet');
  });

  it("names Lidarr's protocol classes, a plugin's too, without the suffix", () => {
    expect(formatDownloadProtocol('TorrentDownloadProtocol')).toBe('Torrent');
    expect(formatDownloadProtocol('UsenetDownloadProtocol')).toBe('Usenet');
    expect(formatDownloadProtocol('LucidaDownloadProtocol')).toBe('Lucida');
  });
});
