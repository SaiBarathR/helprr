import { describe, expect, it } from 'vitest';
import { applyPreset, presetOf, PRESETS } from './presets';

describe('channel presets', () => {
  it.each(PRESETS.map(({ id }) => id))('gives back %s after applying it', (id) => {
    expect(presetOf(applyPreset({ base: {}, types: {} }, id))).toBe(id);
  });

  it('reads an untouched channel as Manual', () => {
    expect(presetOf({ base: {}, types: {} })).toBe('manual');
  });

  it('Live replays only leaves everything but replays alone', () => {
    const { base, types } = applyPreset({ base: {}, types: {} }, 'live');
    expect(base.autoDownload).toBe(false);
    expect(types.ARCHIVE?.autoDownload).toBe(true);
  });

  it('Everything takes videos and replays, and leaves Shorts out', () => {
    const { base, types } = applyPreset({ base: {}, types: {} }, 'everything');
    expect(base.autoDownload).toBe(true);
    expect(types.SHORT?.autoDownload).toBe(false);
  });

  it('keeps custom values when the preset changes', () => {
    const custom = {
      base: { quality: '2160', codec: 'av1', conditions: { titleExclude: ['trailer'] } },
      types: { ARCHIVE: { sponsorblock: 'off' } },
    };
    const next = applyPreset(applyPreset(custom, 'long'), 'live');
    expect(next.base).toMatchObject({ quality: '2160', codec: 'av1', conditions: { titleExclude: ['trailer'] } });
    expect(next.base.conditions).not.toHaveProperty('minDurationMinutes');
    expect(next.types.ARCHIVE).toMatchObject({ sponsorblock: 'off', autoDownload: true });
  });

  it('calls rules of their own Custom', () => {
    expect(presetOf({ base: { autoDownload: true, conditions: { minDurationMinutes: 45 } }, types: {} })).toBeNull();
    expect(presetOf({ base: {}, types: { UPLOAD: { autoDownload: true } } })).toBeNull();
  });
});
