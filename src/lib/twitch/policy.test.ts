import { describe, expect, it } from 'vitest';
import { BUILT_IN_POLICY, evaluatePolicy, layerMap, sanitizeLayer } from '@/lib/twitch/policy';

const video = { title: 'Elden Ring blind run', durationSeconds: 3 * 3600 };

describe('evaluatePolicy', () => {
  it('starts from the built-in defaults with no layers', () => {
    const { policy, trace } = evaluatePolicy(video, {}, true);
    expect(policy).toEqual(BUILT_IN_POLICY);
    expect(trace).toEqual({});
  });

  it('lets each more specific layer win, field by field, and records which one set it', () => {
    const { policy, trace } = evaluatePolicy(video, {
      global: { quality: '720p60', chat: false },
      type: { quality: '480p' },
      streamer: { chat: true },
      streamerType: { quality: '360p' },
      manual: { keepForever: true },
    }, true);
    expect(policy).toMatchObject({ quality: '360p', chat: true, keepForever: true, chapters: true });
    expect(trace).toEqual({ quality: 'streamerType', chat: 'streamer', keepForever: 'manual' });
  });

  it('ignores undefined values, so a partial layer inherits', () => {
    const { policy } = evaluatePolicy(video, { global: { quality: '720p60' }, streamer: { quality: undefined } }, true);
    expect(policy.quality).toBe('720p60');
  });

  it('master switch off beats every layer', () => {
    const decision = evaluatePolicy(video, {
      global: { autoDownload: true },
      type: { autoDownload: true },
      streamer: { autoDownload: true },
      streamerType: { autoDownload: true },
      manual: { autoDownload: true },
    }, false);
    expect(decision.policy.autoDownload).toBe(false);
    expect(decision.autoDownloadReason).toBe('master-switch');
  });

  it('says which layer turned it on or off', () => {
    expect(evaluatePolicy(video, { streamer: { autoDownload: true } }, true).autoDownloadReason).toBe('on in streamer');
    expect(evaluatePolicy(video, { global: { autoDownload: true }, type: { autoDownload: false } }, true).autoDownloadReason).toBe('off in type');
    expect(evaluatePolicy(video, {}, true).autoDownloadReason).toBe('off by default');
  });

  it.each([
    [{ titleExclude: ['ELDEN'] }, false, 'title contains "ELDEN"'],
    [{ titleInclude: ['minecraft'] }, false, 'title has none of the wanted words'],
    [{ titleInclude: ['minecraft', 'ring'] }, true, 'on in global'],
    [{ minDurationMinutes: 240 }, false, 'shorter than the minimum'],
    [{ maxDurationMinutes: 60 }, false, 'longer than the maximum'],
  ])('applies conditions %j', (conditions, expected, reason) => {
    const decision = evaluatePolicy(video, { global: { autoDownload: true, conditions } }, true);
    expect(decision.policy.autoDownload).toBe(expected);
    expect(decision.autoDownloadReason).toBe(reason);
  });

  it.each([
    [{ categoryExclude: ['elden ring'] }, 'Elden Ring', false, 'category is elden ring'],
    [{ categoryInclude: ['Minecraft'] }, 'Elden Ring', false, 'category is not a wanted one'],
    [{ categoryInclude: ['Minecraft'] }, null, false, 'category is not known'],
    [{ categoryInclude: ['elden ring'] }, 'Elden Ring', true, 'on in global'],
    [{ categoryExclude: ['Minecraft'] }, null, true, 'on in global'],
  ])('applies category conditions %j to %s', (conditions, category, expected, reason) => {
    const decision = evaluatePolicy({ ...video, category }, { global: { autoDownload: true, conditions } }, true);
    expect(decision.policy.autoDownload).toBe(expected);
    expect(decision.autoDownloadReason).toBe(reason);
  });

  it('conditions never touch the other fields', () => {
    const decision = evaluatePolicy(video, { global: { autoDownload: true, quality: '480p', conditions: { titleExclude: ['elden'] } } }, true);
    expect(decision.policy.quality).toBe('480p');
  });
});

describe('sanitizeLayer', () => {
  it('drops unknown fields and wrong types', () => {
    expect(sanitizeLayer({ autoDownload: 'yes', quality: '../x', evil: 1, chat: false })).toEqual({ chat: false });
  });

  it('survives junk', () => {
    for (const value of [null, 1, 'x', []]) expect(sanitizeLayer(value)).toEqual({});
  });

  it('keeps null retention, as "no limit"', () => {
    expect(sanitizeLayer({ keepLatest: null, deleteAfterDays: 30 })).toEqual({ keepLatest: null, deleteAfterDays: 30 });
    expect(sanitizeLayer({ keepLatest: -1 })).toEqual({});
  });

  it('cleans conditions', () => {
    expect(sanitizeLayer({ conditions: { titleInclude: ['  a ', '', 5], minDurationMinutes: -1 } }).conditions)
      .toEqual({ titleInclude: ['a'], titleExclude: undefined, categoryInclude: undefined, categoryExclude: undefined, minDurationMinutes: undefined, maxDurationMinutes: undefined });
  });
});

describe('layerMap', () => {
  it('reads only the known video types', () => {
    expect(layerMap({ ARCHIVE: { chat: false }, CLIP: { chat: false }, junk: 1 })).toEqual({ ARCHIVE: { chat: false } });
    expect(layerMap(null)).toEqual({});
  });
});
