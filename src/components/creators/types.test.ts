import { describe, expect, it } from 'vitest';
import { formatGb, stageLabel } from './types';

describe('formatGb', () => {
  it('keeps a short clip from rounding to nothing', () => {
    expect(formatGb(0.002)).toBe('3 MB');
  });

  it('switches to GB at 1 GB', () => {
    expect(formatGb(0.5)).toBe('512 MB');
    expect(formatGb(9.74)).toBe('9.7 GB');
  });
});

describe('stageLabel', () => {
  it('capitalises what the worker reports', () => {
    expect(stageLabel('reading metadata')).toBe('Reading metadata');
  });
});
