import { describe, expect, it } from 'vitest';
import { formatCertificate, formatCommunityRating } from '@/lib/jellyfin-playback/metadata';

describe('formatCommunityRating', () => {
  it('normalises a 0-100 scale down to 0-10', () => {
    // Observed live: this server stores 84 for a title TMDB rates 8.4.
    expect(formatCommunityRating(84)).toBe('★ 8.4');
  });

  it('leaves a 0-10 scale alone', () => {
    expect(formatCommunityRating(8.4)).toBe('★ 8.4');
    expect(formatCommunityRating(10)).toBe('★ 10.0');
  });

  it('returns null for missing or non-positive ratings', () => {
    expect(formatCommunityRating(undefined)).toBeNull();
    expect(formatCommunityRating(0)).toBeNull();
    expect(formatCommunityRating(-1)).toBeNull();
  });
});

describe('formatCertificate', () => {
  it('keeps the first variant and drops the region prefix', () => {
    expect(formatCertificate('US:G / US:Rated G')).toBe('G');
    expect(formatCertificate('US:PG-13 / US:Rated PG-13')).toBe('PG-13');
  });

  it('passes through a plain rating', () => {
    expect(formatCertificate('TV-MA')).toBe('TV-MA');
  });

  it('returns null for missing or empty values', () => {
    expect(formatCertificate(undefined)).toBeNull();
    expect(formatCertificate('')).toBeNull();
    expect(formatCertificate('   ')).toBeNull();
  });
});
