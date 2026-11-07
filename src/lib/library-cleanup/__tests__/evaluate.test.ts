import { describe, expect, it } from 'vitest';
import { evaluateTitle, exclusionsFor, titleKey, type TitleFacts } from '../evaluate';
import { DEFAULT_LIBRARY_RULE, normalizeLibraryCleanupSettings, DEFAULT_LIBRARY_CLEANUP_SETTINGS } from '../config';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-07T12:00:00Z');
const ago = (days: number) => new Date(NOW - days * DAY);

function facts(overrides: Partial<TitleFacts> = {}): TitleFacts {
  return {
    mediaType: 'movie',
    service: 'RADARR',
    instanceId: 'radarr-1',
    instanceLabel: 'Radarr',
    arrId: 12,
    title: 'Old Movie',
    year: 2001,
    tmdbId: 100,
    tvdbId: null,
    imdbId: 'tt100',
    posterUrl: null,
    sizeBytes: 8 * 1024 ** 3,
    added: ago(400).toISOString(),
    rating: 6.1,
    keepTagged: false,
    inJellyfin: true,
    lastWatchedAt: null,
    watchedWithoutDate: false,
    watchlistUserIds: [],
    openRequest: false,
    latestRequestAt: null,
    requestedBy: [],
    requesterUserIds: [],
    downloading: false,
    ...overrides,
  };
}

const rule = { ...DEFAULT_LIBRARY_RULE, unwatchedDays: 180, addedDays: 90 };

describe('library cleanup rule evaluation', () => {
  it('qualifies an old, never-watched title and says why', () => {
    const result = evaluateTitle(facts(), rule, 'keep', NOW);
    expect(result).toEqual({ qualifies: true, reasons: ['Added 400 days ago', 'Never watched'], exclusions: [] });
  });

  it('qualifies a title last watched before the window', () => {
    const result = evaluateTitle(facts({ lastWatchedAt: ago(200) }), rule, 'keep', NOW);
    expect(result.qualifies).toBe(true);
    expect(result.reasons).toContain('Last watched 200 days ago');
  });

  it('needs the title to be added more than M days ago', () => {
    expect(evaluateTitle(facts({ added: ago(30).toISOString() }), rule, 'keep', NOW).qualifies).toBe(false);
    expect(evaluateTitle(facts({ added: null }), rule, 'keep', NOW).exclusions).toContain('Unknown added date');
    expect(evaluateTitle(facts({ added: 'not a date' }), rule, 'keep', NOW).qualifies).toBe(false);
  });

  it('applies the optional size and rating cut-offs', () => {
    expect(evaluateTitle(facts(), { ...rule, minSizeGb: 10 }, 'keep', NOW).qualifies).toBe(false);
    expect(evaluateTitle(facts(), { ...rule, minSizeGb: 5 }, 'keep', NOW).reasons).toContain('At least 5 GB');
    expect(evaluateTitle(facts(), { ...rule, maxRating: 6 }, 'keep', NOW).qualifies).toBe(false);
    expect(evaluateTitle(facts(), { ...rule, maxRating: 7 }, 'keep', NOW).reasons).toContain('Rated 6.1');
    // No rating never matches a rating cut-off.
    expect(evaluateTitle(facts({ rating: null }), { ...rule, maxRating: 7 }, 'keep', NOW).qualifies).toBe(false);
  });

  it.each<[string, Partial<TitleFacts>, string]>([
    ['keep tag', { keepTagged: true }, 'Tagged "keep"'],
    ['watchlist', { watchlistUserIds: ['u1'] }, 'On a watchlist'],
    ['open request', { openRequest: true, latestRequestAt: ago(500) }, 'Open request'],
    ['recent request', { latestRequestAt: ago(10) }, 'Requested in the last 180 days'],
    ['downloading', { downloading: true }, 'Downloading'],
    ['watched recently', { lastWatchedAt: ago(5) }, 'Watched in the last 180 days'],
    ['watched, no date', { watchedWithoutDate: true }, 'Watched, date unknown'],
    ['not in Jellyfin', { inJellyfin: false }, 'Not found in Jellyfin'],
    ['no files', { sizeBytes: 0 }, 'No files on disk'],
  ])('always excludes: %s', (_name, override, label) => {
    const result = evaluateTitle(facts(override), rule, 'keep', NOW);
    expect(result.qualifies).toBe(false);
    expect(result.reasons).toEqual([]);
    expect(result.exclusions).toContain(label);
    expect(exclusionsFor(facts(override), rule.unwatchedDays, 'keep', NOW)).toContain(label);
  });

  it('keeps an old finished request from excluding the title', () => {
    const result = evaluateTitle(facts({ latestRequestAt: ago(300), requestedBy: ['ana'] }), rule, 'keep', NOW);
    expect(result.qualifies).toBe(true);
  });

  it('keys titles by service, instance and arr id', () => {
    expect(titleKey(facts())).toBe('RADARR:radarr-1:12');
  });
});

describe('library cleanup settings validation', () => {
  it('accepts the defaults and lowercases the keep tag', () => {
    const parsed = normalizeLibraryCleanupSettings({ ...DEFAULT_LIBRARY_CLEANUP_SETTINGS, keepTag: ' Keep-Me ' });
    expect(parsed).toEqual({ ok: true, value: { ...DEFAULT_LIBRARY_CLEANUP_SETTINGS, keepTag: 'keep-me' } });
  });

  it.each([
    { keepTag: 'no spaces' },
    { keepTag: '' },
    { countdownDays: 0 },
    { countdownDays: 1.5 },
    { notifyOnMark: 'yes' },
    { movieRule: { ...DEFAULT_LIBRARY_RULE, unwatchedDays: 0 } },
    { seriesRule: { ...DEFAULT_LIBRARY_RULE, maxRating: 11 } },
    { seriesRule: { ...DEFAULT_LIBRARY_RULE, minSizeGb: -1 } },
    { movieRule: null },
  ])('rejects %o', (override) => {
    expect(normalizeLibraryCleanupSettings({ ...DEFAULT_LIBRARY_CLEANUP_SETTINGS, ...override }).ok).toBe(false);
  });
});
