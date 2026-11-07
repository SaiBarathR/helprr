import { describe, expect, it } from 'vitest';
import { migrateUiPrefs, useUIStore } from '@/lib/store';

describe('removed gesture tips', () => {
  it('drops the closed-tips list saved before version 54', () => {
    const migrated = migrateUiPrefs({ dismissedTips: ['long-press'], hapticsEnabled: false }, 53);
    expect(migrated).not.toHaveProperty('dismissedTips');
    expect(migrated).toMatchObject({ hapticsEnabled: false });
  });

  it('ignores the list in an imported settings file', () => {
    useUIStore.getState().applyImportedUiPrefs({ dismissedTips: ['long-press'] });
    expect(useUIStore.getState()).not.toHaveProperty('dismissedTips');
  });
});
