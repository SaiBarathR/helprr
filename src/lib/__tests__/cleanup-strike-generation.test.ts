import { describe, expect, it } from 'vitest';
import { strikeKey, strikesForCurrentTorrents, torrentAddedAt, type StrikeRecord } from '@/lib/cleanup/strikes';

const strike = (hash: string, addedAt: Date | null): [string, StrikeRecord] => [
  strikeKey(hash, 'stall', 'rule-1'),
  { hash, strikeType: 'stall', ruleId: 'rule-1', count: 2, lastDownloadedBytes: null, torrentAddedAt: addedAt, lastSeenAt: new Date() },
];

describe('strike generations', () => {
  it('reads qBittorrent added_on as a date, and none when it reports none', () => {
    expect(torrentAddedAt(1_700_000_000)).toEqual(new Date(1_700_000_000_000));
    expect(torrentAddedAt(0)).toBeNull();
    expect(torrentAddedAt(-1)).toBeNull();
  });

  it('drops strikes counted for an earlier copy of the same hash, or for an unknown one', () => {
    const strikes = new Map([
      strike('aaa', new Date(1_000_000)), // counted for the copy added at 1000 s
      strike('bbb', new Date(2_000_000)), // the same copy as now
      strike('ccc', null), // recorded before add times were kept
      strike('ddd', new Date(3_000_000)), // no longer in qBittorrent
      strike('eee', null), // no longer in qBittorrent either
    ]);
    const current = strikesForCurrentTorrents(strikes, [
      { hash: 'AAA', added_on: 5_000 },
      { hash: 'bbb', added_on: 2_000 },
      { hash: 'ccc', added_on: 6_000 },
    ]);

    expect([...current.values()].map((s) => s.hash)).toEqual(['bbb', 'ddd', 'eee']);
  });

  it('keeps a strike when qBittorrent reports no add time', () => {
    const strikes = new Map([strike('aaa', new Date(1_000_000)), strike('bbb', null)]);
    expect(strikesForCurrentTorrents(strikes, [{ hash: 'aaa', added_on: 0 }, { hash: 'bbb', added_on: 0 }]).size).toBe(2);
  });
});
