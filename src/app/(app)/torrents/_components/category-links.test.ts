import { describe, expect, it } from 'vitest';
import { addSaveFolder } from './category-links';
import type { CategoryDetails } from './use-categories';

// What a disposable qBittorrent 5.1.4 did with a magnet added with no save path,
// for each default mode, "Use Category paths in Manual Mode" and autoTMM sent.
const details = (autoTmmByDefault: boolean | null, categoryPathsInManualMode: boolean | null): CategoryDetails => ({
  categories: {
    own: { name: 'own', savePath: '/downloads/own-folder' },
    empty: { name: 'empty', savePath: '' },
  },
  defaultSavePath: '/downloads',
  subcategories: false,
  autoTmmByDefault,
  categoryPathsInManualMode,
  relocateOnCategoryPathChange: false,
});

describe('addSaveFolder', () => {
  it.each([
    // default mode, category paths in manual mode, autoTMM sent, category → folder
    [false, false, undefined, 'own', '/downloads'],
    [false, false, undefined, undefined, '/downloads'],
    [false, true, undefined, 'own', '/downloads/own-folder'],
    [false, true, undefined, 'empty', '/downloads/empty'],
    [true, false, undefined, 'own', '/downloads/own-folder'],
    [true, false, undefined, 'empty', '/downloads/empty'],
    [true, false, undefined, undefined, '/downloads'],
    [false, false, true, 'own', '/downloads/own-folder'],
    [false, false, true, undefined, '/downloads'],
    [true, false, false, 'own', '/downloads'],
    [true, true, false, 'own', '/downloads/own-folder'],
    [true, true, false, undefined, '/downloads'],
  ] as const)('default auto %s, category paths in manual %s, autoTMM %s, category %s → %s', (auto, manualPaths, sent, category, folder) => {
    expect(addSaveFolder(details(auto, manualPaths), category, sent)).toBe(folder);
  });

  it("is unknown when qBittorrent didn't send the setting that decides it", () => {
    expect(addSaveFolder(details(null, false), 'own', undefined)).toBeNull();
    expect(addSaveFolder(details(false, null), 'own', undefined)).toBeNull();
    // Not needed without a category, or under automatic management.
    expect(addSaveFolder(details(false, null), undefined, undefined)).toBe('/downloads');
    expect(addSaveFolder(details(null, null), 'own', true)).toBe('/downloads/own-folder');
  });
});
