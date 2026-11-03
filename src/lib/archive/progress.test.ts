import { describe, expect, it } from 'vitest';
import { trackStreams, type DownloadProgress } from './progress';

const line = (downloadedBytes: number, totalBytes: number | null, speed: number | null = null): DownloadProgress => ({
  status: 'downloading', downloadedBytes, totalBytes, speed, etaSeconds: null,
});

describe('trackStreams', () => {
  it('adds the sound to the picture instead of starting over', () => {
    const track = trackStreams(1000);
    expect(track(line(450, 900)).progress).toBe(0.45);
    expect(track(line(900, 900)).progress).toBe(0.9);
    expect(track(line(50, 100))).toMatchObject({ progress: 0.95, doneBytes: 950, totalBytes: 1000 });
    expect(track(line(100, 100)).progress).toBe(1);
  });

  it('works out the time left from the whole download', () => {
    expect(trackStreams(1000)(line(200, 900, 100)).etaSeconds).toBe(8);
  });

  it('never goes backwards without a known total', () => {
    const track = trackStreams(null);
    expect(track(line(900, 900)).progress).toBe(1);
    expect(track(line(10, 100)).progress).toBe(1);
  });

  it('stops at 100% when a size was slightly low', () => {
    expect(trackStreams(1000)(line(1100, 1100)).progress).toBe(1);
  });
});
