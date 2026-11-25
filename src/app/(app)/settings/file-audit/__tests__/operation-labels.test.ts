import { describe, expect, it } from 'vitest';
import { FileOperation } from '@prisma/client';
import { OP_LABEL, OP_VARIANT, countLabel, moveMediaPaths } from '../operation-labels';

describe('operation audit labels', () => {
  it('gives every audited operation a badge label and colour', () => {
    for (const op of Object.values(FileOperation)) {
      expect(OP_LABEL[op], op).toMatch(/\S/);
      expect(OP_VARIANT[op], op).toBeDefined();
    }
  });

  it('counts sent releases and added titles in their own nouns', () => {
    expect(countLabel({ operation: 'PUSH_RELEASE', fileCount: 1, mediaType: 'movie' })).toBe('1 release');
    expect(countLabel({ operation: 'CREATE_MEDIA', fileCount: 1, mediaType: 'movie' })).toBe('1 movie');
    expect(countLabel({ operation: 'CREATE_MEDIA', fileCount: 1, mediaType: 'series' })).toBe('1 series');
  });

  it('badges a move as a rename only when the folder changed inside the same root', () => {
    const move = (fromPath: string, path: string) => moveMediaPaths({ operation: 'MOVE_MEDIA', details: { fromPath, path } })?.label;
    expect(move('/m/A (2020)', '/m/B (2020)')).toBe('FOLDER RENAME');
    expect(move('/m/A (2020)/', '/m/B (2020)')).toBe('FOLDER RENAME');
    expect(move('/m/A (2020)', '/other/A (2020)')).toBe('ROOT FOLDER');
    expect(move('/m/A (2020)', '/m/A (2020)/')).toBe('ROOT FOLDER');
  });
});
