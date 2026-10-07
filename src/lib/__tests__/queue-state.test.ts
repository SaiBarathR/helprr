import { describe, expect, it } from 'vitest';
import { isUnmatchedQueueItem } from '@/lib/queue-state';

describe('isUnmatchedQueueItem', () => {
  it('flags a Sonarr or Radarr download with no series or movie', () => {
    // As the *arr returns a download it could not match: explicit nulls.
    expect(isUnmatchedQueueItem({ source: 'sonarr', seriesId: null, series: null })).toBe(true);
    expect(isUnmatchedQueueItem({ source: 'radarr', movieId: null, movie: null })).toBe(true);
    expect(isUnmatchedQueueItem({ source: 'sonarr' })).toBe(true);
  });

  it('does not flag a matched download, by id or by embedded record', () => {
    expect(isUnmatchedQueueItem({ source: 'sonarr', seriesId: 47 })).toBe(false);
    expect(isUnmatchedQueueItem({ source: 'sonarr', seriesId: null, series: { id: 47 } })).toBe(false);
    expect(isUnmatchedQueueItem({ source: 'radarr', movieId: 12 })).toBe(false);
    expect(isUnmatchedQueueItem({ source: 'radarr', movie: { id: 12 } })).toBe(false);
  });

  it('never flags Lidarr, whose queue stays on the default view', () => {
    expect(isUnmatchedQueueItem({ source: 'lidarr' })).toBe(false);
  });
});
