import { describe, expect, it } from 'vitest';
import { parseUsage } from './parse-usage';

describe('parseUsage', () => {
  it('reads a malformed payload as unavailable, not as an empty cache', () => {
    for (const raw of [null, undefined, 'usage', 42, [], {}, { totalBytes: '1024' }, { imageBytes: 10 }]) {
      expect(parseUsage(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it('keeps the numbers it is given and fills in the ones that are missing', () => {
    expect(parseUsage({ totalBytes: 2048, imageBytes: 1024, imageFiles: 3 })).toEqual({
      imageBytes: 1024, tmdbApiBytes: 0, anilistApiBytes: 0, apiBytes: 0, totalBytes: 2048,
      imageFiles: 3, tmdbEntries: 0, anilistEntries: 0, apiEntries: 0, imageDiagnostics: null,
    });
  });

  it('keeps image diagnostics only when they say whether accounting is available', () => {
    const diagnostics = { accountingAvailable: true };
    expect(parseUsage({ totalBytes: 0, imageDiagnostics: diagnostics })?.imageDiagnostics).toBe(diagnostics);
    expect(parseUsage({ totalBytes: 0, imageDiagnostics: { accountingAvailable: 'yes' } })?.imageDiagnostics).toBeNull();
  });
});
