import { describe, expect, it } from 'vitest';
import { inReencodeWindow, worthKeeping } from '@/lib/twitch/reencode-window';

const at = (hours: number, mins = 0) => new Date(2026, 9, 30, hours, mins);

describe('inReencodeWindow', () => {
  it.each([
    [at(0, 59), false],
    [at(1), true],
    [at(7, 59), true],
    [at(8), false],
    [at(14), false],
  ])('handles a same-day window at %s', (time, expected) => {
    expect(inReencodeWindow(time, '01:00', '08:00')).toBe(expected);
  });

  it.each([
    [at(21, 59), false],
    [at(22), true],
    [at(23, 59), true],
    [at(0), true],
    [at(5, 59), true],
    [at(6), false],
  ])('handles a window across midnight at %s', (time, expected) => {
    expect(inReencodeWindow(time, '22:00', '06:00')).toBe(expected);
  });

  it('treats equal ends as always', () => {
    expect(inReencodeWindow(at(12), '03:00', '03:00')).toBe(true);
  });
});

describe('worthKeeping', () => {
  it('needs at least ten percent off', () => {
    expect(worthKeeping(1000, 900)).toBe(true);
    expect(worthKeeping(1000, 901)).toBe(false);
    expect(worthKeeping(1000, 1200)).toBe(false);
  });
});
