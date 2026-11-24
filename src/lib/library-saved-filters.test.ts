import { describe, expect, it } from 'vitest';
import {
  hasLibraryFilterState,
  renameSavedLibraryFilter,
  sameLibraryFilterState,
  sanitizeSavedLibraryFilters,
  saveLibraryFilter,
  type LibraryFilterState,
} from './library-saved-filters';
import { EMPTY_LIBRARY_FACETS, MOVIE_FILTERS } from './library-filtering';

const state = (over: Partial<LibraryFilterState> = {}): LibraryFilterState => ({
  status: [], facets: { ...EMPTY_LIBRARY_FACETS }, instance: 'all', watch: 'all', ...over,
});

describe('saved library filters', () => {
  it('saves a copy under a new id, and saving the same name again replaces it', () => {
    const current = state({ status: ['monitored'], facets: { ...EMPTY_LIBRARY_FACETS, tags: ['a:3'] } });
    const first = saveLibraryFilter([], '  4K wanted ', current, () => 'id1');
    expect(first).toEqual({ replaced: false, list: [{ id: 'id1', name: '4K wanted', ...current }] });
    current.facets.tags.push('a:4');
    expect(first.list[0].facets.tags).toEqual(['a:3']);

    const second = saveLibraryFilter(first.list, '4k WANTED', state({ instance: 'b' }), () => 'id2');
    expect(second.replaced).toBe(true);
    expect(second.list).toEqual([{ id: 'id1', name: '4k WANTED', ...state({ instance: 'b' }) }]);
  });

  it('refuses a rename to a blank name or one another filter has', () => {
    const list = [
      { id: '1', name: 'One', ...state() },
      { id: '2', name: 'Two', ...state() },
    ];
    expect(renameSavedLibraryFilter(list, '1', 'two')).toBeNull();
    expect(renameSavedLibraryFilter(list, '1', '   ')).toBeNull();
    expect(renameSavedLibraryFilter(list, '1', 'ONE')?.map((f) => f.name)).toEqual(['ONE', 'Two']);
  });

  it('compares filters whatever order they were picked in', () => {
    const a = state({ status: ['missing', 'monitored'], facets: { ...EMPTY_LIBRARY_FACETS, genres: ['A', 'B'] } });
    const b = state({ status: ['monitored', 'missing'], facets: { ...EMPTY_LIBRARY_FACETS, genres: ['B', 'A'] } });
    expect(sameLibraryFilterState(a, b)).toBe(true);
    expect(sameLibraryFilterState(a, { ...b, watch: 'watched' })).toBe(false);
    expect(hasLibraryFilterState(state())).toBe(false);
    expect(hasLibraryFilterState(state({ instance: 'x' }))).toBe(true);
  });

  it('reads a stored or imported list safely', () => {
    const out = sanitizeSavedLibraryFilters([
      { id: 'ok', name: ' Kept ', status: ['missing', 'bogus', 3], facets: { tags: ['a:1', 5], genres: 'Drama' }, instance: 'x', watch: 'watched' },
      { id: 'ok', name: 'Same id again' },
      { id: '', name: 'No id' },
      { id: 'blank', name: '   ' },
      'junk',
      { id: 'defaults', name: 'Defaults', watch: 'maybe' },
    ], MOVIE_FILTERS);
    expect(out).toEqual([
      { id: 'ok', name: 'Kept', status: ['missing'], facets: { tags: ['a:1'], qualityProfiles: [], rootFolders: [], genres: [] }, instance: 'x', watch: 'watched' },
      { id: 'defaults', name: 'Defaults', ...state() },
    ]);
    expect(sanitizeSavedLibraryFilters({ id: 'x' }, MOVIE_FILTERS)).toBeNull();
  });
});
