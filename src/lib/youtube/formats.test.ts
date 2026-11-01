import { describe, expect, it } from 'vitest';
import { formatSelector, pickOffered, selectedBytes, summarizeFormats } from './formats';

describe('formatSelector', () => {
  it('defaults to the common option, falling back rather than failing', () => {
    expect(formatSelector('1080', 'compatible')).toBe('bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b');
  });

  it.each([
    ['2160', 'av1', 'bv*[height<=2160][vcodec^=av01]+ba/bv*[height<=2160]+ba/b'],
    ['1440', 'vp9', 'bv*[height<=1440][vcodec^=vp9]+ba/bv*[height<=1440]+ba/b'],
    ['720', 'best', 'bv*[height<=720]+ba/bv*[height<=720]+ba/b'],
    ['best', 'best', 'bv*+ba/bv*+ba/b'],
  ])('builds %s %s', (quality, codec, selector) => {
    expect(formatSelector(quality, codec)).toBe(selector);
  });

  it('never lets anything but a fixed choice into the selector', () => {
    const selector = formatSelector('1080]/worst[', 'x"; rm -rf /');
    expect(selector).toBe('bv*+ba/bv*+ba/b');
  });
});

describe('selectedBytes', () => {
  it('adds the video and the audio, using an estimate where that is all there is', () => {
    expect(selectedBytes([{ filesize: 900 }, { filesize_approx: 100 }])).toBe(1000);
  });

  it('gives no figure when any part has none, rather than a low one', () => {
    expect(selectedBytes([{ filesize: 900 }, { filesize: null }])).toBeNull();
    expect(selectedBytes(undefined)).toBeNull();
  });
});

// Shaped like what yt-dlp gave for a real Trash Taste episode.
const RAW = [
  { vcodec: 'none', acodec: 'none', ext: 'mhtml', height: 90 },
  { vcodec: 'none', acodec: 'mp4a.40.2', ext: 'm4a', filesize: 23_000_000 },
  { vcodec: 'none', acodec: 'mp4a.40.2', ext: 'm4a', filesize: 60_000_000 },
  { vcodec: 'none', acodec: 'opus', ext: 'webm', filesize: 90_000_000 },
  { vcodec: 'avc1.640028', acodec: 'none', ext: 'mp4', height: 1080, filesize: 1_993_000_000 },
  { vcodec: 'avc1.640028', acodec: 'mp4a', ext: 'mp4', height: 1080 },
  { vcodec: 'vp09.00.50.08', acodec: 'none', ext: 'mp4', height: 2160 },
  { vcodec: 'vp9', acodec: 'none', ext: 'webm', height: 2160, filesize: 8_095_000_000 },
  { vcodec: 'av01.0.13M.08', acodec: 'none', ext: 'mp4', height: 2160, filesize: 9_293_000_000 },
  { vcodec: 'av01.0.08M.08', acodec: 'none', ext: 'mp4', height: 1080, filesize_approx: 1_603_000_000 },
];

describe('summarizeFormats', () => {
  const summary = summarizeFormats(RAW);

  it('gives one entry per height and codec, tallest first, keeping the copy with a size', () => {
    expect(summary.offered).toEqual([
      { height: 2160, codec: 'vp9', bytes: 8_095_000_000 },
      { height: 2160, codec: 'av1', bytes: 9_293_000_000 },
      { height: 1080, codec: 'h264', bytes: 1_993_000_000 },
      { height: 1080, codec: 'av1', bytes: 1_603_000_000 },
    ]);
  });

  it('measures the m4a audio that the default selector picks', () => {
    expect(summary.audioBytes).toBe(60_000_000);
  });

  it('keeps no link', () => {
    const withLink = summarizeFormats([{ ...RAW[4], url: 'https://rr1.googlevideo.com/signed' } as never]);
    expect(JSON.stringify(withLink)).not.toContain('googlevideo');
  });

  it('copes with a video offering nothing', () => {
    expect(summarizeFormats([])).toEqual({ offered: [], audioBytes: null });
  });

  it.each([
    ['1080', 'compatible', 1080, 'h264'],
    ['2160', 'av1', 2160, 'av1'],
    ['2160', 'compatible', 1080, 'h264'],
    ['best', 'compatible', 1080, 'h264'],
    ['best', 'best', 2160, 'vp9'],
    ['720', 'compatible', undefined, undefined],
  ] as const)('says %s %s lands on what it really will', (quality, codec, height, picked) => {
    expect(pickOffered(summary, quality, codec)?.height).toBe(height);
    expect(pickOffered(summary, quality, codec)?.codec).toBe(picked);
  });
});
