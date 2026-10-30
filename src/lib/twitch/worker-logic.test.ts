import { describe, expect, it } from 'vitest';
import { chapterGenres, chaptersToFfmetadata } from '@/lib/twitch/chapters';
import { classifyJobError, nextStepAfterFailure } from '@/lib/twitch/job-errors';
import { archiveEpisode, episodeBaseName, safeFilenameTitle, seasonFolder } from '@/lib/twitch/naming';
import { episodeNfo, seasonNfo, tvshowNfo } from '@/lib/twitch/nfo';
import { parseProgressLine } from '@/lib/twitch/progress';
import { estimateSizeBytes, pickFormat, type YtDlpFormat } from '@/lib/twitch/quality';

const formats: YtDlpFormat[] = [
  { format_id: 'sb0', height: 90, ext: 'mhtml', format_note: 'storyboard' },
  { format_id: 'audio_only', vcodec: 'none' },
  { format_id: '160p', height: 160, fps: 30 },
  { format_id: '480p', height: 480, fps: 30 },
  { format_id: '720p60', height: 720, fps: 60 },
  { format_id: '1080p60', height: 1080, fps: 60 },
];

describe('pickFormat', () => {
  it('takes the wanted quality', () => expect(pickFormat(formats, '720p60')).toBe('720p60'));
  it('falls to the next lower', () => expect(pickFormat(formats, '1440p60')).toBe('1080p60'));
  it('falls to next lower by frame rate too', () => expect(pickFormat(formats, '720p')).toBe('480p'));
  it('takes the lowest when nothing is low enough', () => expect(pickFormat(formats, '144p')).toBe('160p'));
  it('never picks a storyboard', () => expect(pickFormat(formats.slice(0, 2), '1080p60')).toBeNull());
  it('handles audio only', () => expect(pickFormat(formats, 'audio_only')).toBe('audio_only'));
  it('reads the list a real Twitch video returns', () => {
    const real: YtDlpFormat[] = [
      { format_id: 'sb1', height: 62, vcodec: 'none', fps: 0.2 },
      { format_id: 'Audio_Only', height: null, vcodec: 'none' },
      { format_id: '160p', height: 160, fps: 30 },
      { format_id: '720p', height: 720, fps: 30 },
      { format_id: '1080p', height: 1080, fps: 30 },
    ];
    expect(pickFormat(real, 'audio_only')).toBe('Audio_Only');
    expect(pickFormat(real, '1080p60')).toBe('1080p');
    expect(pickFormat(real, '720p60')).toBe('720p');
  });
});

describe('estimateSizeBytes', () => {
  it('uses the measured rate for six hours of 1080p60', () => {
    expect(estimateSizeBytes('1080p60', 6 * 3600) / 1024 ** 3).toBeCloseTo(20.76, 1);
  });
});

describe('chaptersToFfmetadata', () => {
  it('clips the last chapter to the real duration and escapes syntax', () => {
    const text = chaptersToFfmetadata([
      { start_time: 0, end_time: 60, title: 'Just Chatting' },
      { start_time: 60, end_time: 9999, title: 'A=B; #1' },
    ], 120)!;
    expect(text.startsWith(';FFMETADATA1\n')).toBe(true);
    expect(text).toContain(String.raw`START=60000`);
    expect(text).toContain('END=120000');
    expect(text).toContain(String.raw`title=A\=B\; \#1`);
  });

  it('drops chapters past the end, and returns null with none left', () => {
    expect(chaptersToFfmetadata([{ start_time: 500, title: 'Late' }], 120)).toBeNull();
    expect(chaptersToFfmetadata([], 120)).toBeNull();
  });

  it('fills a missing end from the next chapter', () => {
    expect(chaptersToFfmetadata([{ start_time: 0, title: 'A' }, { start_time: 30, title: 'B' }], 60)).toContain('END=30000');
  });

  it('lists each game once for the genres', () => {
    expect(chapterGenres([{ start_time: 0, title: 'A' }, { start_time: 1, title: 'B' }, { start_time: 2, title: 'A' }])).toEqual(['A', 'B']);
  });
});

describe('classifyJobError', () => {
  it.each([
    ['OSError: No space left on device', 'disk'],
    ['This video is only available to subscribers', 'subOnly'],
    ['HTTP Error 403: Forbidden', 'auth'],
    ['HTTP Error 404: Not Found', 'gone'],
    ['Video 123 does not exist', 'gone'],
    ['validation failed: no audio stream', 'validation'],
    ['ERROR: Unable to extract video data', 'extractor'],
    ['Read timed out', 'transient'],
    ['HTTP Error 502: Bad Gateway', 'transient'],
  ])('reads %s', (message, expected) => expect(classifyJobError(message)).toBe(expected));
});

describe('nextStepAfterFailure', () => {
  it('blocks on disk', () => expect(nextStepAfterFailure('disk', 1)).toEqual({ state: 'BLOCKED' }));
  it('fails at once on what a retry cannot fix', () => {
    expect(nextStepAfterFailure('auth', 1)).toEqual({ state: 'FAILED' });
    expect(nextStepAfterFailure('gone', 1)).toEqual({ state: 'FAILED' });
  });
  it('backs off exponentially', () => {
    expect(nextStepAfterFailure('transient', 1)).toEqual({ state: 'RETRY_WAIT', delayMs: 60_000 });
    expect(nextStepAfterFailure('transient', 3)).toEqual({ state: 'RETRY_WAIT', delayMs: 240_000 });
  });
  it('stops after six attempts', () => expect(nextStepAfterFailure('transient', 6)).toEqual({ state: 'FAILED' }));
});

describe('parseProgressLine', () => {
  it('reads the template output', () => {
    expect(parseProgressLine('{"s":"downloading","d":100,"t":400,"e":5,"v":20.5}')).toEqual({
      status: 'downloading', downloadedBytes: 100, totalBytes: 400, etaSeconds: 5, speed: 20.5,
    });
  });
  it('tolerates yt-dlp nulls', () => expect(parseProgressLine('{"s":"finished","d":1,"t":null,"e":null,"v":null}')?.totalBytes).toBeNull());
  it('reads a real line from a VOD, with its bare NA fields', () => {
    expect(parseProgressLine('{"s":"downloading","d":7168,"t":NA,"te":883608.0,"e":NA,"v":441.5}')).toEqual({
      status: 'downloading', downloadedBytes: 7168, totalBytes: 883608, etaSeconds: (883608 - 7168) / 441.5, speed: 441.5,
    });
  });
  it('reads the last line of a real download', () => {
    expect(parseProgressLine('{"s":"finished","d":1643120,"t":1643120,"te":NA,"e":NA,"v":1037330.4}')).toMatchObject({
      totalBytes: 1643120, etaSeconds: null,
    });
  });
  it('does not touch NA inside a value', () => {
    expect(parseProgressLine('{"s":"NA:NA","d":1,"t":2,"te":NA,"e":1,"v":1}')?.status).toBe('NA:NA');
  });
  it('ignores everything else', () => {
    expect(parseProgressLine('[info] Downloading')).toBeNull();
    expect(parseProgressLine('{"s":broken')).toBeNull();
  });
});

describe('naming', () => {
  it('removes illegal characters and the word Jellyfin skips', () => {
    expect(safeFilenameTitle('a/b: c?')).toBe('a b c');
    expect(safeFilenameTitle('Free SAMPLE run')).toBe('Free run');
    expect(safeFilenameTitle('...')).toBe('Untitled');
    expect(safeFilenameTitle('../../etc')).not.toContain('/');
    expect([...safeFilenameTitle('x'.repeat(500))]).toHaveLength(120);
  });

  it('numbers an archive from its local time', () => {
    expect(archiveEpisode(new Date(2026, 9, 29, 15, 30))).toEqual({ season: 2026, episode: 10291530 });
    expect(archiveEpisode(new Date(2026, 11, 31, 23, 59)).episode).toBeLessThan(2 ** 31);
  });

  it('keeps two same-day VODs apart', () => {
    expect(archiveEpisode(new Date(2026, 9, 29, 9, 0)).episode).not.toBe(archiveEpisode(new Date(2026, 9, 29, 21, 0)).episode);
  });

  it('builds the tested filename and season folders', () => {
    expect(episodeBaseName({
      folderName: 'xqc', season: 2026, episode: 10291530, date: new Date(2026, 9, 29, 15, 30),
      title: 'Elden Ring blind run', twitchVideoId: '2345678901',
    })).toBe('xqc - S2026E10291530 - 2026-10-29 - Elden Ring blind run [v2345678901]');
    expect(seasonFolder('ARCHIVE', 2026)).toBe('Season 2026');
    expect(seasonFolder('HIGHLIGHT', 2026)).toBe('Season 01 Highlights');
    expect(seasonFolder('UPLOAD', 2026)).toBe('Season 02 Uploads');
  });
});

describe('NFO', () => {
  const episode = {
    title: 'Fish & <Chips>', displayName: 'Name', season: 2026, episode: 10291530,
    date: new Date(2026, 9, 29, 15, 30), addedAt: new Date(2026, 9, 30, 1, 2, 3), durationSeconds: 3660,
    description: null, type: 'archive' as const, genres: ['Elden Ring', 'Just Chatting'], twitchVideoId: '123',
  };

  it('writes an episode with the lookup tag and a genre per game, escaped', () => {
    const text = episodeNfo(episode);
    expect(text).toContain('<title>Fish &amp; &lt;Chips&gt;</title>');
    expect(text).toContain('<tag>twitch-v123</tag>');
    expect(text).toContain('<uniqueid type="twitch" default="true">123</uniqueid>');
    expect(text).toContain('<genre>Elden Ring</genre>');
    expect(text).toContain('<runtime>61</runtime>');
    expect(text).toContain('<dateadded>2026-10-30 01:02:03</dateadded>');
  });

  it('strips characters XML cannot carry', () => {
    expect(episodeNfo({ ...episode, title: 'a\u0007b' })).toContain('<title>ab</title>');
  });

  it('never locks the series', () => {
    const text = tvshowNfo({ displayName: 'N', login: 'n', description: '', broadcasterType: '', twitchUserId: '1' });
    expect(text).not.toContain('lockdata');
    expect(text).toContain('<uniqueid type="twitch" default="true">1</uniqueid>');
  });

  it('writes a season', () => {
    expect(seasonNfo('Highlights', 1)).toContain('<seasonnumber>1</seasonnumber>');
  });
});
