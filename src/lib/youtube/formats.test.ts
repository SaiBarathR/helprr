import { describe, expect, it } from 'vitest';
import hdr from './fixtures/hdr-60fps.json';
import ltt from './fixtures/ltt-16-9.json';
import mkbhd from './fixtures/mkbhd-2-1.json';
import short from './fixtures/short-portrait.json';
import wan from './fixtures/wan-1080.json';
import { codecLabelOf, pickDownload, qualityLabel, qualityOf, resolutionLabel, summarizeFormats } from './formats';

// Trimmed from what yt-dlp really returned for these videos, so each shape stays covered.
const MKBHD = summarizeFormats(mkbhd);
const LTT = summarizeFormats(ltt);
const SHORT = summarizeFormats(short);
const WAN = summarizeFormats(wan);
const HDR = summarizeFormats(hdr);

const classes = (formats: typeof MKBHD) => [...new Set(formats.offered.map(({ quality }) => quality))];

describe('qualityOf', () => {
  it.each([
    [3840, 2160, 2160], [3840, 1920, 2160], [4096, 2160, 2160], [2560, 1280, 1440], [1920, 960, 1080], [1920, 800, 1080],
    [1280, 640, 720], [854, 428, 480], [1080, 1920, 1080], [720, 1280, 720], [1440, 1080, 1080], [640, 480, 480], [7680, 4320, 4320],
  ])('calls %d×%d %dp', (width, height, quality) => {
    expect(qualityOf(width, height)).toBe(quality);
  });
});

describe('qualityLabel', () => {
  it.each([[4320, '8K'], [2160, '4K'], [1440, '1440p'], [720, '720p']])('names %d', (quality, label) => {
    expect(qualityLabel(quality)).toBe(label);
  });
});

describe('summarizeFormats, on real videos', () => {
  it('finds 4K on a 2:1 video, where the picture is only 1920 high', () => {
    expect(classes(MKBHD).slice(0, 5)).toEqual([2160, 1440, 1080, 720, 480]);
    expect(MKBHD.offered[0]).toMatchObject({ id: '313', quality: 2160, width: 3840, height: 1920, codec: 'vp9' });
  });

  it('stops where the video stops', () => {
    expect(classes(WAN)[0]).toBe(1080);
  });

  it('keeps the full picture of a Short, which is taller than wide', () => {
    expect(classes(SHORT)[0]).toBe(1080);
    expect(SHORT.offered[0]).toMatchObject({ width: 1080, height: 1920, fps: 60 });
  });

  it('prefers the copy with a size over the HLS one, and never the one with sound in it', () => {
    expect(WAN.offered.filter(({ quality }) => quality === 1080).map(({ id }) => id)).toEqual(['137', '248', '399']);
    expect(LTT.offered.find(({ quality, codec }) => quality === 360 && codec === 'h264')).toMatchObject({ id: '134', muxed: false });
  });

  it('uses a known size over a smoother copy with none', () => {
    expect(SHORT.offered.find(({ quality, codec }) => quality === 720 && codec === 'h264')).toMatchObject({ id: '298', fps: 60 });
  });

  it('takes the original voice, never a dub or the DRC track', () => {
    expect(MKBHD.audio).toEqual([
      { id: '140-5', codec: 'aac', bytes: expect.any(Number) },
      { id: '251-5', codec: 'opus', bytes: expect.any(Number) },
    ]);
    expect(LTT.audio.map(({ id }) => id)).toEqual(['140', '251']);
  });

  it('keeps HDR apart from the normal copy', () => {
    const at4k = HDR.offered.filter(({ quality }) => quality === 2160);
    expect(at4k.map(codecLabelOf)).toEqual(['VP9', 'VP9 HDR', 'AV1 HDR']);
  });

  it('stores no link', () => {
    const summary = summarizeFormats([{ ...mkbhd.find(({ format_id }) => format_id === '313')!, url: 'https://rr1.googlevideo.com/x?sig=1' } as never]);
    expect(JSON.stringify(summary)).not.toContain('googlevideo');
  });

  it('handles a video with no formats', () => {
    expect(summarizeFormats([])).toEqual({ offered: [], audio: [] });
    expect(pickDownload(summarizeFormats([]), '1080', 'compatible')).toBeNull();
  });
});

describe('pickDownload', () => {
  it('means 4K when asked for 4K, even when H.264 stops at 1080p', () => {
    expect(pickDownload(MKBHD, '2160', 'compatible')).toMatchObject({ selector: '313+251-5', video: { quality: 2160, codec: 'vp9' } });
    expect(pickDownload(LTT, '1440', 'compatible')?.video).toMatchObject({ quality: 1440, codec: 'vp9' });
    expect(pickDownload(MKBHD, 'best', 'compatible')?.video.quality).toBe(2160);
  });

  it('uses H.264 and AAC wherever they exist', () => {
    expect(pickDownload(MKBHD, '1080', 'compatible')).toMatchObject({ selector: '137+140-5', video: { width: 1920, height: 960 } });
    expect(pickDownload(MKBHD, '720', 'compatible')?.selector).toBe('136+140-5');
  });

  it('gives the codec asked for at that quality', () => {
    expect(pickDownload(MKBHD, '2160', 'av1')?.selector).toBe('401+251-5');
    expect(pickDownload(LTT, '1080', 'vp9')?.selector).toBe('248+251');
  });

  it('adds the sound to the size', () => {
    const picked = pickDownload(LTT, '1080', 'compatible');
    expect(picked?.bytes).toBe(470_580_710 + 27_422_886);
  });

  it('falls to the nearest quality when the video stops lower', () => {
    expect(pickDownload(WAN, '2160', 'compatible')?.video).toMatchObject({ quality: 1080, codec: 'h264' });
    expect(pickDownload(WAN, 'best', 'av1')?.video).toMatchObject({ quality: 1080, codec: 'av1' });
  });

  it('gives a Short its full height at 1080p', () => {
    expect(pickDownload(SHORT, '1080', 'compatible')).toMatchObject({ selector: '299+140', video: { width: 1080, height: 1920 } });
  });

  it('stays SDR unless HDR is asked for, or the codec is left to the best', () => {
    expect(pickDownload(HDR, '2160', 'vp9')?.video).toMatchObject({ id: '315', hdr: false });
    expect(pickDownload(HDR, '2160', 'vp9', true)?.video).toMatchObject({ id: '337', hdr: true });
    expect(pickDownload(HDR, '2160', 'best')?.video).toMatchObject({ id: '701', hdr: true });
    expect(pickDownload(HDR, '2160', 'compatible')?.video).toMatchObject({ id: '315', hdr: false });
  });

  it('takes the only AV1 copy when it is the HDR one', () => {
    expect(pickDownload(HDR, '2160', 'av1')?.video).toMatchObject({ id: '701', hdr: true });
  });

  it('adds no sound to a copy that has its own', () => {
    const video = { format_id: '18', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', width: 640, height: 360, filesize: 100 };
    const formats = summarizeFormats([video, { format_id: '140', vcodec: 'none', acodec: 'mp4a.40.2', filesize: 50 }]);
    expect(pickDownload(formats, '1080', 'compatible')).toMatchObject({ selector: '18', audio: null, bytes: 100 });
  });

  it('still gets sound when YouTube offers only a kind Helprr cannot name', () => {
    const video = { format_id: '137', vcodec: 'avc1.640028', acodec: 'none', width: 1920, height: 1080, filesize: 100 };
    const formats = summarizeFormats([video, { format_id: '328', vcodec: 'none', acodec: 'ec-3', filesize: 50 }]);
    expect(pickDownload(formats, '1080', 'compatible')).toMatchObject({ selector: '137+ba', bytes: null });
  });

  it('fetches the copy the sheet showed, even when a better one has appeared since', () => {
    expect(pickDownload(MKBHD, 'best', 'compatible', false, '401')?.selector).toBe('401+251-5');
  });

  it('decides afresh when that copy is gone, and never trusts an id that is not on the list', () => {
    expect(pickDownload(MKBHD, '1080', 'compatible', false, 'gone')?.selector).toBe('137+140-5');
    expect(pickDownload(MKBHD, '1080', 'compatible', false, 'bestvideo[ext=mp4]')?.selector).toBe('137+140-5');
  });

  it('admits when the size is not known', () => {
    const video = { format_id: '270', vcodec: 'avc1.640028', acodec: 'none', width: 1920, height: 1080 };
    const formats = summarizeFormats([video, { format_id: '140', vcodec: 'none', acodec: 'mp4a.40.2', filesize: 50 }]);
    expect(pickDownload(formats, '1080', 'compatible')?.bytes).toBeNull();
  });
});

describe('resolutionLabel', () => {
  it('shows the name and the real pixels', () => {
    expect(resolutionLabel(pickDownload(MKBHD, '2160', 'vp9')!.video)).toBe('4K (3840×1920)');
    expect(resolutionLabel(pickDownload(SHORT, '1080', 'vp9')!.video)).toBe('1080p (1080×1920), 60 fps');
  });
});
