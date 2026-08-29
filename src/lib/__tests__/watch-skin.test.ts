import { describe, expect, it } from 'vitest';
import { migrateUiPrefs, STORE_VERSION } from '@/lib/store';
import { UI_PREF_CATEGORY_FIELDS } from '@/lib/settings-export';
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/dashboard-theme';

describe('watchSkin preference', () => {
  it('defaults existing users to the classic skin', () => {
    const migrated = migrateUiPrefs({ navPosition: 'bottom' }, 45);

    expect(migrated.watchSkin).toBe('classic');
    // Migrating the new field must not disturb anything already persisted.
    expect(migrated.navPosition).toBe('bottom');
  });

  it('leaves an already-chosen skin alone on later migrations', () => {
    const migrated = migrateUiPrefs({ watchSkin: 'cinematic' }, STORE_VERSION);

    expect(migrated.watchSkin).toBe('cinematic');
  });

  it('travels in exactly one settings-export category', () => {
    const categories = Object.entries(UI_PREF_CATEGORY_FIELDS)
      .filter(([, fields]) => fields.includes('watchSkin'))
      .map(([id]) => id);

    expect(categories).toEqual(['watch']);
  });

  it('is replayed onto <html> pre-paint so the skin survives first paint', () => {
    // The cinematic skin is a CSS scope keyed on this attribute. Without the
    // bootstrap replay every Watch navigation paints classic and snaps once
    // the store rehydrates.
    expect(THEME_BOOTSTRAP_SCRIPT).toContain('watchSkin');
    expect(THEME_BOOTSTRAP_SCRIPT).toContain('dataset.watchSkin');
  });
});
