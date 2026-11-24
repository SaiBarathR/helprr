import { describe, expect, it } from 'vitest';
import type { HistoryItem } from '@/types';
import fixture from './__fixtures__/arr-upgrade-history.json';
import { radarrUpgradeOf, sonarrUpgradeOf, upgradeBody } from './upgrade-imports';

// Real Sonarr/Radarr history rows, newest first, as the poller reads them.
const sonarr = fixture.sonarr as unknown as HistoryItem[];
const radarr = fixture.radarr as unknown as HistoryItem[];
const row = (rows: HistoryItem[], id: number) => rows.find((r) => r.id === id)!;

describe('telling an upgrade from a new arrival (real history)', () => {
  it('Sonarr: the first import of an episode is new; the later one that deleted its file for "Upgrade" is an upgrade', () => {
    expect(sonarrUpgradeOf(row(sonarr, 9531), sonarr)).toBeUndefined();
    const replaced = sonarrUpgradeOf(row(sonarr, 9556), sonarr);
    expect(replaced?.id).toBe(9555);
    expect(upgradeBody(row(sonarr, 9556), replaced!)).toBe('WEBDL-1080p → HDTV-1080p: Merry Berry Love (2026) s01e03 [Mkv - 1080p H264 - MultiLang Aac 2.0 - MultiSubs]');
  });

  it('Sonarr: a deletion written one second before its import still pairs with it', () => {
    expect(sonarrUpgradeOf(row(sonarr, 9487), sonarr)).toBeUndefined();
    expect(sonarrUpgradeOf(row(sonarr, 9490), sonarr)?.id).toBe(9489);
  });

  it('Radarr: a 1080p copy replaced by 2160p is an upgrade; its first import is new', () => {
    expect(radarrUpgradeOf(row(radarr, 1165), radarr)).toBeUndefined();
    const replaced = radarrUpgradeOf(row(radarr, 1168), radarr)!;
    expect(upgradeBody(row(radarr, 1168), replaced)).toMatch(/^WEBDL-1080p → WEBDL-2160p: Primetime\.2026\.2160p/);
  });

  it('Radarr: two upgrades of one movie on one day each pair with their own deletion', () => {
    expect(radarrUpgradeOf(row(radarr, 1115), radarr)).toBeUndefined();
    expect(radarrUpgradeOf(row(radarr, 1121), radarr)?.id).toBe(1120);
    const second = radarrUpgradeOf(row(radarr, 1124), radarr)!;
    expect(second.id).toBe(1123);
    // Same quality name: a better release (a proper or custom-format score), said as such.
    expect(upgradeBody(row(radarr, 1124), second)).toMatch(/^Better WEBDL-2160p: Insidious Out Of The Further/);
  });

  it('pairs only with the same episode or movie, a reason of "Upgrade", and a deletion within a minute', () => {
    const imported = row(sonarr, 9556);
    const deleted = row(sonarr, 9555);
    expect(sonarrUpgradeOf(imported, [imported, { ...deleted, episodeId: 1 }])).toBeUndefined();
    expect(sonarrUpgradeOf(imported, [imported, { ...deleted, data: { reason: 'Manual' } }])).toBeUndefined();
    expect(sonarrUpgradeOf(imported, [imported, { ...deleted, date: '2026-10-24T11:42:00Z' }])).toBeUndefined();
    expect(radarrUpgradeOf(row(radarr, 1168), [row(radarr, 1168), { ...row(radarr, 1167), movieId: 1 }])).toBeUndefined();
  });

  it('never pairs an import with a deletion written after it (two releases imported in one sweep)', () => {
    // #10 is the movie's first file; 20 s later #12 replaces it, deleting it first (#11).
    const first = { ...row(radarr, 1165), id: 10, date: '2026-11-03T05:53:00Z' };
    const deleted = { ...row(radarr, 1167), id: 11, date: '2026-11-03T05:53:20Z' };
    const second = { ...row(radarr, 1168), id: 12, date: '2026-11-03T05:53:20Z' };
    const fetched = [second, deleted, first];
    expect(radarrUpgradeOf(first, fetched)).toBeUndefined();
    expect(radarrUpgradeOf(second, fetched)?.id).toBe(11);
  });

  it('falls back to the release name when a quality is missing', () => {
    const imported = row(radarr, 1168);
    const deleted = { ...row(radarr, 1167), quality: undefined } as unknown as HistoryItem;
    expect(upgradeBody(imported, deleted)).toBe(imported.sourceTitle);
  });
});
