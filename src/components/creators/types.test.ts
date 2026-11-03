import { describe, expect, it } from 'vitest';
import { fileQuality, formatGb, stageLabel } from './types';

describe('formatGb', () => {
  it('keeps a short clip from rounding to nothing', () => {
    expect(formatGb(0.002)).toBe('3 MB');
  });

  it('switches to GB at 1 GB', () => {
    expect(formatGb(0.5)).toBe('512 MB');
    expect(formatGb(9.74)).toBe('9.7 GB');
  });
});

describe('fileQuality', () => {
  it('names a file by its shape, not its height', () => {
    expect(fileQuality({ width: 1280, height: 640 })).toBe('720p');
    expect(fileQuality({ width: 3840, height: 1920 })).toBe('4K');
    expect(fileQuality({ width: 1080, height: 1920 })).toBe('1080p');
  });

  it('keeps to the height for a file saved before widths were recorded', () => {
    expect(fileQuality({ width: null, height: 1080 })).toBe('1080p');
    expect(fileQuality({ width: null, height: null })).toBeNull();
  });
});

describe('stageLabel', () => {
  it('capitalises what the worker reports', () => {
    expect(stageLabel('reading metadata')).toBe('Reading metadata');
  });
});
