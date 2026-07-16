import type { AniListMediaListEntryBase } from '@/lib/anilist-mutations';

/** Parse GET /api/anilist/list-entry JSON and normalize score for the viewer format. */
export function parseAnilistListEntryResponse(
  data: unknown,
  scoreFormat?: string | null,
): AniListMediaListEntryBase | null {
  const entry =
    data && typeof data === 'object' && 'entry' in data
      ? ((data as { entry?: AniListMediaListEntryBase | null }).entry ?? null)
      : null;
  if (!entry) return null;
  if (scoreFormat === 'POINT_10_DECIMAL' && entry.score != null && entry.score > 10) {
    return { ...entry, score: entry.score / 10 };
  }
  return entry;
}
