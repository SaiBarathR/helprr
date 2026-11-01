import { describe, expect, it } from 'vitest';
import { formatSelector, selectedBytes } from './formats';

describe('formatSelector', () => {
  it('defaults to the common option, falling back rather than failing', () => {
    expect(formatSelector('1080', 'compatible')).toBe('bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b');
  });

  it.each([
    ['2160', 'av1', 'bv*[height<=2160][vcodec^=av01]+ba/bv*[height<=2160]+ba/b'],
    ['1440', 'vp9', 'bv*[height<=1440][vcodec^=vp09]+ba/bv*[height<=1440]+ba/b'],
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
