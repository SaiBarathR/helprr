// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveFile } from './save-file';

afterEach(() => vi.unstubAllGlobals());

describe('saveFile on iOS', () => {
  it('shares the file alone: a title made iOS save a second "text" item next to it', async () => {
    const share = vi.fn(async () => {});
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15',
      platform: 'iPhone',
      maxTouchPoints: 5,
      share,
      canShare: () => true,
    });
    await expect(saveFile(new Blob(['d8:announce']), 'Big Buck Bunny.torrent')).resolves.toBe('saved');
    expect(share).toHaveBeenCalledWith({ files: [expect.any(File)] });
  });
});
