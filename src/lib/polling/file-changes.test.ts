import { describe, expect, it } from 'vitest';
import type { HistoryItem } from '@/types';
import fixture from './__fixtures__/arr-file-history.json';
import { fileChangeNotices } from './file-changes';

// Real Sonarr/Radarr history rows, newest first, as the poller reads them.
const sonarr = fixture.sonarr as unknown as HistoryItem[];
const radarr = fixture.radarr as unknown as HistoryItem[];
const one = { instanceId: 'i1', instanceLabel: 'Main', instanceCount: 1 };
const sent = (notices: ReturnType<typeof fileChangeNotices>) => notices.map(({ event }) => ({
  eventType: event.eventType, title: event.title, body: event.body, url: event.url,
}));

describe('file deleted and renamed, from real history', () => {
  it('Sonarr: one "File Deleted" per file, never for an upgrade, and one "Files Renamed" per series', () => {
    expect(sent(fileChangeNotices(sonarr, { service: 'sonarr', ...one }))).toEqual([
      { eventType: 'fileDeleted', title: 'Episode File Deleted', body: 'Monster S01E03 (Bluray-720p): deleted', url: '/series/301/season/1/episode/13554?instance=i1' },
      { eventType: 'fileDeleted', title: 'Episode File Deleted', body: 'Monster S01E02 (Bluray-576p): deleted', url: '/series/301/season/1/episode/13553?instance=i1' },
      { eventType: 'fileDeleted', title: 'Episode File Deleted', body: 'Monster S01E01 (HDTV-1080p): deleted', url: '/series/301/season/1/episode/13552?instance=i1' },
      // 9555 is the old file of the upgrade imported as 9556: not a deletion to tell.
      { eventType: 'fileDeleted', title: 'Episode File Deleted', body: expect.stringMatching(/^Something in the Rain S01E16 \(.+\): missing from disk$/), url: expect.stringContaining('/series/') },
      { eventType: 'fileDeleted', title: 'Episode File Deleted', body: expect.stringMatching(/^Something in the Rain S01E15 \(.+\): missing from disk$/), url: expect.stringContaining('/series/') },
      // Four rows of one series rename, then a single file renamed in another series.
      { eventType: 'fileRenamed', title: 'Files Renamed', body: 'Monster: 4 files renamed', url: '/series/301?instance=i1' },
      {
        eventType: 'fileRenamed',
        title: 'File Renamed',
        body: 'Haikyu!! S01E02: now Haikyu!! (2014) - S01E02 - 002 - Karasuno High School Volleyball Club [HDTV-1080p][Opus 2.0][EN+JA][x265 10bit].mkv',
        url: expect.stringMatching(/^\/series\/\d+\?instance=i1$/),
      },
    ]);
  });

  it('Radarr: a movie found missing, deleted by hand and renamed; its upgrade deletion is left out', () => {
    expect(sent(fileChangeNotices(radarr, { service: 'radarr', ...one }))).toEqual([
      { eventType: 'fileDeleted', title: 'Movie File Deleted', body: 'Maa Inti Bangaram (2026) (WEBRip-1080p): missing from disk', url: '/movies/549?instance=i1' },
      { eventType: 'fileDeleted', title: 'Movie File Deleted', body: expect.stringMatching(/^Maa Inti Bangaram \(2026\) \(.+\): deleted$/), url: '/movies/549?instance=i1' },
      { eventType: 'fileRenamed', title: 'File Renamed', body: 'Maa Inti Bangaram (2026): now Maa Inti Bangaram (2026) HDTV-1080p.mp4', url: '/movies/549?instance=i1' },
    ]);
  });

  it('never names a folder on the arr\'s disk', () => {
    const bodies = [...fileChangeNotices(sonarr, { service: 'sonarr', ...one }), ...fileChangeNotices(radarr, { service: 'radarr', ...one })]
      .map(({ event }) => event.body);
    for (const body of bodies) expect(body).not.toMatch(/Season 01\/|\/mnt\/|file path removed/);
  });

  it('names the instance when there are several, and says the other reasons', () => {
    const row = sonarr.find((r) => r.id === 9604)!;
    const notices = fileChangeNotices([
      { ...row, data: { reason: 'NoLinkedEpisodes' } },
      { ...row, id: 1, data: { reason: 'ManualOverride' } },
      { ...row, id: 2, data: { reason: 'SomethingNew' } },
      { ...row, id: 3, data: { reason: 'Upgrade' } },
    ], { service: 'sonarr', instanceId: 'i2', instanceLabel: 'Anime', instanceCount: 2 });
    expect(notices.map(({ event }) => [event.title, event.body.split(': ')[1]])).toEqual([
      ['Anime · Episode File Deleted', 'no longer linked to an episode'],
      ['Anime · Episode File Deleted', 'replaced by a manual import'],
      ['Anime · Episode File Deleted', 'deleted'],
    ]);
  });

  it('ignores the other service\'s rows and rows without a title', () => {
    expect(fileChangeNotices(radarr, { service: 'sonarr', ...one })).toEqual([]);
    const row = radarr.find((r) => r.id === 1025)!;
    expect(fileChangeNotices([{ ...row, movie: undefined }], { service: 'radarr', ...one })).toEqual([]);
  });
});
