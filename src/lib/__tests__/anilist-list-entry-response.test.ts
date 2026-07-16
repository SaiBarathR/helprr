import { describe, expect, it } from 'vitest';
import { parseAnilistListEntryResponse } from '@/lib/anilist-list-entry-response';
import type { AniListMediaListEntryBase } from '@/lib/anilist-mutations';

const baseEntry: AniListMediaListEntryBase = {
  id: 1,
  status: 'CURRENT',
  score: 85,
  progress: 5,
  progressVolumes: null,
  repeat: 0,
  notes: 'test note',
  startedAt: null,
  completedAt: null,
  updatedAt: null,
};

describe('parseAnilistListEntryResponse', () => {
  it('returns null when entry is missing', () => {
    expect(parseAnilistListEntryResponse({ entry: null })).toBeNull();
    expect(parseAnilistListEntryResponse({})).toBeNull();
    expect(parseAnilistListEntryResponse(null)).toBeNull();
  });

  it('returns entry fields from API wrapper', () => {
    expect(parseAnilistListEntryResponse({ entry: baseEntry })).toEqual(baseEntry);
  });

  it('normalizes POINT_10_DECIMAL scores above 10', () => {
    const parsed = parseAnilistListEntryResponse({ entry: { ...baseEntry, score: 85 } }, 'POINT_10_DECIMAL');
    expect(parsed?.score).toBe(8.5);
  });

  it('leaves POINT_10_DECIMAL scores at or below 10 unchanged', () => {
    const parsed = parseAnilistListEntryResponse({ entry: { ...baseEntry, score: 8 } }, 'POINT_10_DECIMAL');
    expect(parsed?.score).toBe(8);
  });
});
