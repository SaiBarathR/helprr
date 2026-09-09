import { describe, expect, it } from 'vitest';
import { TorrentDeltaHistory } from './qbittorrent-delta';
import { applyTorrentDelta } from '@/lib/qbittorrent-delta';
import type { QBittorrentSummaryResponse, QBittorrentTorrent } from '@/types';
const row = (hash: string, extra: Partial<QBittorrentTorrent> = {}) => ({ hash, name: `Torrent ${hash}`, progress: 0, state: 'downloading', ...extra }) as QBittorrentTorrent;
const snapshot = (...torrents: QBittorrentTorrent[]): QBittorrentSummaryResponse => ({ torrents, transferInfo: null, speedLimitsMode: 0 });
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));
describe('authorized bounded torrent delta history', () => {
  it('handles additions, removals, fields, order and independent tabs without resurrecting rows', () => {
    const history = new TorrentDeltaHistory();
    const first = snapshot(row('a'), row('b'));
    const reset = history.response('user-filter-version', undefined, first);
    const tabA = applyTorrentDelta(undefined, wire(reset));
    const next = snapshot(row('c'), row('a', { progress: .5 }));
    const delta = history.response('user-filter-version', reset.cursor, next);
    expect(delta.reset).toBe(false);
    expect(delta.removed).toEqual(['b']);
    expect(delta.changed).toContainEqual({ hash: 'a', progress: .5 });
    expect(applyTorrentDelta(tabA, wire(delta))).toEqual(next);
    // Another tab still using the old cursor receives a valid independent diff.
    expect(applyTorrentDelta(first, wire(history.response('user-filter-version', reset.cursor, next)))).toEqual(next);
    const unchanged = history.response('user-filter-version', delta.cursor, next);
    expect(unchanged.changed).toEqual([]);
    expect(unchanged.order).toBeUndefined();
  });
  it('resets for other users, filters, mutation versions, unknown cursors, expiry and memory eviction', () => {
    const history = new TorrentDeltaHistory();
    const first = history.response('user-a/filter-a/v1', undefined, snapshot(row('a')), 1000);
    for (const scope of ['user-b/filter-a/v1', 'user-a/filter-b/v1', 'user-a/filter-a/v2']) {
      expect(history.response(scope, first.cursor, snapshot(row('b')), 1001).reset).toBe(true);
    }
    expect(history.response('user-a/filter-a/v1', 'unknown', snapshot(row('a')), 1001).reset).toBe(true);
    expect(history.response('user-a/filter-a/v1', first.cursor, snapshot(row('a')), 62002).reset).toBe(true);
    const tiny = new TorrentDeltaHistory(1);
    const oversized = tiny.response('scope', undefined, snapshot(row('a')));
    expect(tiny.response('scope', oversized.cursor, snapshot(row('a'))).reset).toBe(true);
  });
  it('clears fields missing from a later upstream response across JSON serialization', () => {
    const history = new TorrentDeltaHistory();
    const first = snapshot(row('a', { category: 'movies' }));
    const initial = history.response('scope', undefined, first);
    const next = snapshot(row('a'));
    const delta = wire(history.response('scope', initial.cursor, next));
    expect(applyTorrentDelta(first, delta)).toEqual(next);
    expect(first.torrents[0].category).toBe('movies');
  });
  it.each([100, 1000, 5000])('avoids repeated stable metadata for %i actively downloading torrents', (count) => {
    const history = new TorrentDeltaHistory();
    const rows = Array.from({ length: count }, (_, i) => row(String(i), { magnet_uri: 'x'.repeat(200), tracker: 'y'.repeat(100) }));
    const first = snapshot(...rows);
    const initial = history.response('scope', undefined, first);
    const next = snapshot(...rows.map(r => ({ ...r, progress: .5, dlspeed: 12345 })));
    const delta = history.response('scope', initial.cursor, next);
    expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(next).length / 3);
    expect(applyTorrentDelta(first, wire(delta))).toEqual(next);
  });
});
