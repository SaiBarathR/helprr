import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notify: vi.fn<(event: unknown, context?: unknown) => Promise<number | null>>(async () => 1),
  wanted: vi.fn(async (notices: unknown[]) => notices),
  redis: new Map<string, string>(),
  failSet: false,
}));

vi.mock('@/lib/redis', () => ({
  getRedisClient: async () => ({
    get: async (key: string) => mocks.redis.get(key) ?? null,
    set: async (key: string, value: string) => {
      if (mocks.failSet) throw new Error('OOM command not allowed');
      mocks.redis.set(key, value);
    },
  }),
}));
vi.mock('./shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./shared')>()),
  notifyAndLog: mocks.notify,
  wantedNotices: mocks.wanted,
}));

import { diffLibrary, notifyLibraryChanges, type LibraryItem } from './library-changes';

const main = { connection: { id: 's1', label: 'Main', url: 'http://sonarr:8989', apiKey: 'key-1' } };
const anime = { connection: { id: 's2', label: 'Anime', url: 'http://sonarr-anime:8989', apiKey: 'key-2' } };
const series = (id: number, title: string, year?: number, instanceId = 's1'): LibraryItem => ({ id, title, year, instanceId });
const read = (items: LibraryItem[], failedInstanceIds: string[] = [], cached = false) => ({ items, failedInstanceIds, cached });
const noGrouping = async () => false;
const sent = () => mocks.notify.mock.calls.map(([event]) => {
  const e = event as { eventType: string; title: string; body: string; url: string };
  return { eventType: e.eventType, title: e.title, body: e.body, url: e.url };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redis.clear();
  mocks.failSet = false;
});

describe('diffLibrary', () => {
  it('compares only with a list of the same connection version', () => {
    const known = { version: 'v1', titles: [[1, 'A'], [2, 'B']] as Array<[number, string]> };
    expect(diffLibrary(known, 'v1', [[2, 'B'], [3, 'C']])).toEqual({ added: [[3, 'C']], deleted: [[1, 'A']] });
    expect(diffLibrary(known, 'v2', [[3, 'C']])).toBeNull();
    expect(diffLibrary(null, 'v1', [[3, 'C']])).toBeNull();
  });
});

describe('notifyLibraryChanges', () => {
  it('records the first list silently, then tells what was added and deleted', async () => {
    await notifyLibraryChanges('sonarr', [main], read([series(1, 'Severance', 2022), series(2, 'Monster', 2004)]), noGrouping);
    expect(mocks.notify).not.toHaveBeenCalled();

    await notifyLibraryChanges('sonarr', [main], read([series(1, 'Severance', 2022), series(3, 'Pluribus', 2025)]), noGrouping);
    expect(sent()).toEqual([
      { eventType: 'titleAdded', title: 'Series Added', body: 'Pluribus (2025)', url: '/series/3?instance=s1' },
      // Gone from the list: named from the last one, and the library opens.
      { eventType: 'titleDeleted', title: 'Series Deleted', body: 'Monster (2004)', url: '/series' },
    ]);
    const deleted = mocks.notify.mock.calls[1][0] as { metadata: Record<string, unknown> };
    expect(deleted.metadata).not.toHaveProperty('seriesId');

    // Nothing changed: nothing sent, nothing written.
    mocks.notify.mockClear();
    await notifyLibraryChanges('sonarr', [main], read([series(1, 'Severance', 2022), series(3, 'Pluribus', 2025)]), noGrouping);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('does not repeat a year the title already ends with (as Sonarr names a series that shares its name)', async () => {
    await notifyLibraryChanges('sonarr', [main], read([]), noGrouping);
    await notifyLibraryChanges('sonarr', [main], read([series(23, 'Love in Disguise (2026)', 2026), series(24, 'Ao Ashi', 2022)]), noGrouping);
    expect(sent().map((e) => e.body)).toEqual(['Love in Disguise (2026)', 'Ao Ashi (2022)']);
  });

  it('Radarr titles open the movie, and a deleted one the Movies page', async () => {
    const radarr = (id: number, title: string): LibraryItem => ({ id, title, year: 2026, instanceId: 's1' });
    await notifyLibraryChanges('radarr', [main], read([radarr(1, 'Primetime')]), noGrouping);
    await notifyLibraryChanges('radarr', [main], read([radarr(2, 'Fackham Hall')]), noGrouping);
    expect(sent()).toEqual([
      { eventType: 'titleAdded', title: 'Movie Added', body: 'Fackham Hall (2026)', url: '/movies/2?instance=s1' },
      { eventType: 'titleDeleted', title: 'Movie Deleted', body: 'Primetime (2026)', url: '/movies' },
    ]);
  });

  it('never reads an instance that did not answer as emptied', async () => {
    const both = [series(1, 'Severance'), series(5, 'Frieren', 2023, 's2')];
    await notifyLibraryChanges('sonarr', [main, anime], read(both), noGrouping);
    // Main failed this time: its items are missing, not deleted. Anime's change is told.
    await notifyLibraryChanges('sonarr', [main, anime], read([series(5, 'Frieren', 2023, 's2'), series(6, 'Dandadan', 2024, 's2')], ['s1']), noGrouping);
    expect(sent()).toEqual([{ eventType: 'titleAdded', title: 'Anime · Series Added', body: 'Dandadan (2024)', url: '/series/6?instance=s2' }]);
  });

  it('starts again silently when the connection changed (another address may be another library)', async () => {
    await notifyLibraryChanges('sonarr', [main], read([series(1, 'Severance')]), noGrouping);
    const edited = { connection: { ...main.connection, url: 'http://other-sonarr:8989' } };
    await notifyLibraryChanges('sonarr', [edited], read([series(9, 'Something Else')]), noGrouping);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('keeps comparing after a rename, which changes nothing about the library', async () => {
    await notifyLibraryChanges('sonarr', [main], read([series(1, 'Severance')]), noGrouping);
    const renamed = { connection: { ...main.connection, label: 'Main 4K' } };
    await notifyLibraryChanges('sonarr', [renamed], read([series(1, 'Severance'), series(3, 'Pluribus', 2025)]), noGrouping);
    expect(sent()).toEqual([{ eventType: 'titleAdded', title: 'Series Added', body: 'Pluribus (2025)', url: '/series/3?instance=s1' }]);
  });

  it('records a first list only from a live read, never from the cache (it may predate a new or re-pointed instance)', async () => {
    // Anime was just added: the cached library holds only Main's titles.
    await notifyLibraryChanges('sonarr', [main], read([series(1, 'Severance')]), noGrouping);
    await notifyLibraryChanges('sonarr', [main, anime], read([series(1, 'Severance')], [], true), noGrouping);
    // The live read after the cache is cleared is Anime's first list, so its library is not "added".
    await notifyLibraryChanges('sonarr', [main, anime], read([series(1, 'Severance'), series(5, 'Frieren', 2023, 's2')]), noGrouping);
    expect(mocks.notify).not.toHaveBeenCalled();
    // A cache hit still tells changes against a list it can be compared with.
    await notifyLibraryChanges('sonarr', [main, anime], read([series(5, 'Frieren', 2023, 's2'), series(6, 'Dandadan', 2024, 's2')], [], true), noGrouping);
    expect(sent().map((e) => [e.title, e.body])).toEqual([['Main · Series Deleted', 'Severance'], ['Anime · Series Added', 'Dandadan (2024)']]);
  });

  it('sends nothing when the new list cannot be saved, so a change is never told every cycle', async () => {
    await notifyLibraryChanges('sonarr', [main], read([series(1, 'Severance')]), noGrouping);
    mocks.failSet = true;
    await notifyLibraryChanges('sonarr', [main], read([series(1, 'Severance'), series(2, 'Monster')]), noGrouping);
    await notifyLibraryChanges('sonarr', [main], read([series(1, 'Severance'), series(2, 'Monster')]), noGrouping);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('keeps the list up to date while nobody takes the events, so turning them on later tells only new changes', async () => {
    mocks.wanted.mockImplementation(async () => []);
    await notifyLibraryChanges('sonarr', [main], read([series(1, 'Severance')]), noGrouping);
    await notifyLibraryChanges('sonarr', [main], read([series(1, 'Severance'), series(2, 'Monster')]), noGrouping);
    expect(mocks.notify).not.toHaveBeenCalled();
    mocks.wanted.mockImplementation(async (notices: unknown[]) => notices);
    await notifyLibraryChanges('sonarr', [main], read([series(1, 'Severance'), series(2, 'Monster'), series(3, 'Pluribus')]), noGrouping);
    expect(sent().map((e) => e.body)).toEqual(['Pluribus']);
  });

  it('with grouping on, an import list adding many titles is one notification opening the library', async () => {
    await notifyLibraryChanges('radarr', [main], read([]), noGrouping);
    const added = Array.from({ length: 5 }, (_, i): LibraryItem => ({ id: i + 1, title: `Film ${i + 1}`, instanceId: 's1' }));
    await notifyLibraryChanges('radarr', [main], read(added), async () => true);
    expect(sent()).toEqual([{
      eventType: 'titleAdded', title: '5 Movies Added', body: 'Film 1 · Film 2 · Film 3 · …and 2 more', url: '/movies',
    }]);
  });
});
