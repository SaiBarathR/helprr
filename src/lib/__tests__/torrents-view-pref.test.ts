import { describe, expect, it } from 'vitest';
import { migrateUiPrefs, STORE_VERSION } from '@/lib/store';

describe('torrentsView preference', () => {
  it('moves the old card default to automatic', () => {
    expect(migrateUiPrefs({ torrentsView: 'card' }, 47).torrentsView).toBe('auto');
    expect(migrateUiPrefs({}, 39).torrentsView).toBe('auto');
  });

  it('keeps a chosen table view', () => {
    expect(migrateUiPrefs({ torrentsView: 'table' }, 47).torrentsView).toBe('table');
  });

  it('adds nothing to an import that left torrent prefs out', () => {
    expect(migrateUiPrefs({ navPosition: 'bottom' }, 47)).not.toHaveProperty('torrentsView');
  });

  it('leaves later choices alone', () => {
    expect(migrateUiPrefs({ torrentsView: 'card' }, STORE_VERSION).torrentsView).toBe('card');
  });
});
