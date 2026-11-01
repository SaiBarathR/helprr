import { describe, expect, it } from 'vitest';
import { bitrateLabel, codecLabel, jobLabel, savedBytes, savedPercent, type FileJob } from './file-types';

const job = (overrides: Partial<FileJob>): FileJob => ({
  id: 'j', kind: 'REENCODE', state: 'QUEUED', stage: null, progress: null, priority: 0, ...overrides,
});

describe('savedBytes', () => {
  const reencodedAt = '2026-10-31T00:00:00.000Z';

  it('is the difference once a re-encode has kept its original size', () => {
    expect(savedBytes({ reencodedAt, sizeBytes: 300, originalSizeBytes: 1000 })).toBe(700);
    expect(savedPercent({ reencodedAt, sizeBytes: 300, originalSizeBytes: 1000 })).toBe(70);
  });

  it('claims nothing when the original size was never recorded', () => {
    expect(savedBytes({ reencodedAt, sizeBytes: 300, originalSizeBytes: null })).toBeNull();
    expect(savedPercent({ reencodedAt, sizeBytes: 300, originalSizeBytes: null })).toBeNull();
  });

  it('is nothing for a file that was not re-encoded', () => {
    expect(savedBytes({ reencodedAt: null, sizeBytes: 300, originalSizeBytes: 1000 })).toBeNull();
  });
});

describe('bitrateLabel', () => {
  it('reads in megabits', () => {
    expect(bitrateLabel(1_000_000, 8)).toBe('1.0 Mbps');
    expect(bitrateLabel(25_000_000, 10)).toBe('20 Mbps');
  });

  it('has no answer without a length', () => {
    expect(bitrateLabel(1000, 0)).toBeNull();
  });
});

describe('codecLabel', () => {
  it('names the codecs people know', () => {
    expect(codecLabel('h264')).toBe('H.264');
    expect(codecLabel('hevc')).toBe('HEVC');
    expect(codecLabel('vp9')).toBe('VP9');
  });
});

describe('jobLabel', () => {
  it('tells a night job from one asked for now', () => {
    expect(jobLabel(job({}))).toBe('Waiting for tonight');
    expect(jobLabel(job({ priority: 100 }))).toBe('Re-encoding soon');
  });

  it('shows the progress of a running encode', () => {
    expect(jobLabel(job({ state: 'RUNNING', progress: 0.42 }))).toBe('Re-encoding 42%');
  });

  it.each([
    ['DELETE_ORIGINAL', 'Deleting original'],
    ['RESTORE_ORIGINAL', 'Restoring original'],
    ['DELETE_FILES', 'Deleting'],
  ] as const)('names %s', (kind, label) => {
    expect(jobLabel(job({ kind }))).toBe(label);
  });
});
