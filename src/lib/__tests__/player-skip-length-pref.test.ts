import { afterEach, describe, expect, it } from 'vitest';
import { migrateUiPrefs, useUIStore } from '@/lib/store';
import { UI_PREF_CATEGORY_FIELDS } from '@/lib/settings-export';
import { DEFAULT_SKIP_SECONDS } from '@/lib/jellyfin-playback/skip-length';

const initial = useUIStore.getState();
afterEach(() => useUIStore.setState(initial, true));

describe('player skip length preference', () => {
  it('starts at ten seconds each way, the length the player always used', () => {
    expect(initial.playerSkipBackSeconds).toBe(DEFAULT_SKIP_SECONDS);
    expect(initial.playerSkipForwardSeconds).toBe(DEFAULT_SKIP_SECONDS);
    expect(DEFAULT_SKIP_SECONDS).toBe(10);
  });

  it('accepts only the offered lengths', () => {
    useUIStore.getState().setPlayerSkipBackSeconds(30);
    useUIStore.getState().setPlayerSkipForwardSeconds(7);

    expect(useUIStore.getState().playerSkipBackSeconds).toBe(30);
    expect(useUIStore.getState().playerSkipForwardSeconds).toBe(10);
  });

  it('migration replaces an unusable saved value and adds none that was absent', () => {
    expect(migrateUiPrefs({ playerSkipBackSeconds: 'x', playerSkipForwardSeconds: 45 }, 50)).toMatchObject({
      playerSkipBackSeconds: 10,
      playerSkipForwardSeconds: 45,
    });
    expect(migrateUiPrefs({ navPosition: 'top' }, 50)).not.toHaveProperty('playerSkipBackSeconds');
  });

  it('a settings import drops values that are not offered lengths', () => {
    useUIStore.getState().applyImportedUiPrefs({ playerSkipBackSeconds: 15, playerSkipForwardSeconds: 1000 });

    expect(useUIStore.getState().playerSkipBackSeconds).toBe(15);
    expect(useUIStore.getState().playerSkipForwardSeconds).toBe(10);
  });

  it('travels with playback in the settings export', () => {
    expect(UI_PREF_CATEGORY_FIELDS.playback).toEqual(
      expect.arrayContaining(['playerSkipBackSeconds', 'playerSkipForwardSeconds']),
    );
  });
});
