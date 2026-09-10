import { describe, expect, it } from 'vitest';
import { prepareMovieRows, deriveMovieBaseRows, searchPreparedRows, preparedItems } from './library-filtering';
import type { RadarrMovieListItem } from '@/types';
describe('large-library search preserves ordering and instance identity', () => {
  it.each([500, 5_000, 20_000])('filters %i prepared rows without re-sorting or rebuilding keys', (count) => {
    const movies = Array.from({ length: count }, (_, index) => ({ id: index % 1000, instanceId: String(Math.floor(index / 1000)), title: `Title ${index}`, sortTitle: String(count - index).padStart(6, '0'), monitored: index % 2 === 0, year: 2026 } as RadarrMovieListItem));
    const start = performance.now();
    const prepared = prepareMovieRows(movies);
    const base = deriveMovieBaseRows(prepared, { filter: ['monitored'], instanceFilter: 'all', sort: 'title', sortDir: 'asc' });
    const preparedMs = performance.now() - start;
    const searchAt = performance.now();
    const result = searchPreparedRows(base, 'TITLE 12');
    const searchMs = performance.now() - searchAt;
    expect(result.every((row) => base.includes(row))).toBe(true);
    expect(preparedItems(result)).toEqual(movies.filter((movie) => movie.monitored && movie.title.toLowerCase().includes('title 12')).sort((a, b) => a.sortTitle.localeCompare(b.sortTitle)));
    expect(new Set(prepared.map((row) => row.key)).size).toBe(count);
    console.info(JSON.stringify({ fixture: 'library', count, preparedMs, searchMs }));
  });
});
