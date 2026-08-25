import { describe, expect, it } from 'vitest';
import { formatLanguageCode, formatRegionCode, formatRegionCodes } from './media-locale';

describe('media locale formatting', () => {
  it('formats ISO language and region codes for display', () => {
    expect(formatLanguageCode('ja')).toBe('Japanese');
    expect(formatRegionCode('JP')).toBe('Japan');
    expect(formatRegionCodes(['US', 'GB'])).toBe('United States, United Kingdom');
  });

  it('handles missing values', () => {
    expect(formatLanguageCode(null)).toBeNull();
    expect(formatRegionCodes([])).toBeNull();
  });
});
