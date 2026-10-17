import { describe, expect, it } from 'vitest';
import { EXPORT_FORMAT_KIND, EXPORT_FORMAT_VERSION, validateImportFile } from '@/lib/settings-export';
import { STORE_VERSION } from '@/lib/store';
import { prepareWatchlist } from '@/lib/settings-import/watchlist';
import { prepareScheduledAlerts } from '@/lib/settings-import/alerts';
import { prepareAnimeMappings } from '@/lib/settings-import/anime-mappings';
import type { ExportedAnimeMappings, ExportedWatchlist } from '@/lib/settings-export';

describe('an import file from a newer Helprr', () => {
  const file = (overrides: Record<string, unknown>) => ({
    kind: EXPORT_FORMAT_KIND, version: EXPORT_FORMAT_VERSION, zustandVersion: STORE_VERSION, ...overrides,
  });

  it('is accepted at the current versions', () => {
    expect(validateImportFile(file({}))).toMatchObject({ ok: true });
  });

  it('is refused when its format version is newer', () => {
    expect(validateImportFile(file({ version: EXPORT_FORMAT_VERSION + 1 }))).toEqual({
      ok: false,
      error: `Unsupported export format version (${EXPORT_FORMAT_VERSION + 1}). Update Helprr and try again.`,
    });
  });

  it('is refused when its preferences come from a newer store', () => {
    expect(validateImportFile(file({ zustandVersion: STORE_VERSION + 1 }))).toEqual({
      ok: false,
      error: 'This export was created by a newer version of Helprr. Update first, then import.',
    });
  });
});

describe('duplicate entries in one import file', () => {
  it('fold into one watchlist item: first added date, latest fields, every tag', () => {
    const skipped: string[] = [];
    const prepared = prepareWatchlist({
      items: [
        { source: 'TMDB', externalId: '603', mediaType: 'movie', title: 'The Matrix', posterUrl: 'https://image.tmdb.org/t/p/w500/a.jpg', rating: 87, addedAt: '2024-01-01T00:00:00.000Z', tags: ['sci-fi'] },
        { source: 'tmdb', externalId: 603, mediaType: 'MOVIE', title: 'The Matrix (1999)', posterUrl: '', rating: null, addedAt: '2025-06-01T00:00:00.000Z', tags: ['rewatch'] },
        { source: 'TMDB', externalId: '603', mediaType: 'series', title: 'Not the same item', tags: [] },
      ],
      tags: [],
    } as unknown as ExportedWatchlist, skipped)!;

    expect(prepared.items).toHaveLength(2);
    expect(prepared.items[0]).toMatchObject({
      title: 'The Matrix (1999)',
      posterUrl: 'https://image.tmdb.org/t/p/w500/a.jpg',
      rating: 87,
      addedAt: new Date('2024-01-01T00:00:00.000Z'),
      tagNames: ['sci-fi', 'rewatch'],
    });
    expect(skipped).toEqual([]);
  });

  it('keep the first of two alerts for the same title and schedule', () => {
    const alert = (title: string) => ({ source: 'TMDB', externalId: '603', mediaType: 'movie', title, scheduleMode: 'release_relative' });
    const prepared = prepareScheduledAlerts([alert('First'), alert('Second'), { ...alert('Other'), externalId: '604' }], [], 'Owner');

    expect(prepared.map((a) => a.title)).toEqual(['First', 'Other']);
  });

  it('keep one AniList entry per anime mapping, with exactly one primary', () => {
    const prepared = prepareAnimeMappings({
      mappings: [{
        state: 'MANUAL_MATCH', sonarrSeriesId: 12, sonarrInstanceLabel: 'Sonarr', seriesTitleSnapshot: 'Frieren',
        entries: [
          { anilistMediaId: 154587, isPrimary: true },
          { anilistMediaId: 154587, isPrimary: true },
          { anilistMediaId: 182255, isPrimary: true },
        ],
      }],
    } as unknown as ExportedAnimeMappings, [])!;

    expect(prepared[0].entries.map((e) => [e.anilistMediaId, e.isPrimary])).toEqual([[154587, true], [182255, false]]);
  });
});
