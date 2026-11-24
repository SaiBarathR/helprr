import { describe, expect, it } from 'vitest';
import { summarizeQualityProfile } from '@/lib/quality-profile-summary';
import type { QualityProfileResource } from '@/types';

// Sonarr's shape: items least preferred first, a group (id 1000) as the cutoff.
const PROFILE: QualityProfileResource = {
  id: 6,
  name: 'HD - 720p/1080p',
  upgradeAllowed: true,
  cutoff: 1000,
  minFormatScore: -100,
  cutoffFormatScore: 500,
  minUpgradeFormatScore: 1,
  items: [
    { quality: { id: 0, name: 'Unknown' }, items: [], allowed: false },
    { quality: { id: 1, name: 'SDTV' }, items: [], allowed: true },
    {
      id: 1000,
      name: 'WEB 1080p',
      allowed: true,
      items: [
        { quality: { id: 15, name: 'WEBRip-1080p' }, items: [], allowed: true },
        { quality: { id: 3, name: 'WEBDL-1080p' }, items: [], allowed: true },
        { quality: { id: 99, name: 'Off member' }, items: [], allowed: false },
      ],
    },
    { quality: { id: 7, name: 'Bluray-1080p' }, items: [], allowed: true },
    { quality: { id: 19, name: 'Bluray-2160p' }, items: [], allowed: false },
  ],
  formatItems: [
    { format: 1, name: 'x265', score: 0 },
    { format: 2, name: 'BR-DISK', score: -10000 },
    { format: 3, name: 'AMZN', score: 50 },
    { format: 4, name: 'Anime', score: 0 },
    { format: 5, name: 'Repack', score: 50 },
  ],
};

describe('summarizeQualityProfile', () => {
  it('lists allowed qualities most preferred first, with group members and the cutoff marked', () => {
    const summary = summarizeQualityProfile(PROFILE);
    expect(summary.qualities).toEqual([
      { name: 'Bluray-1080p', isCutoff: false, members: [] },
      { name: 'WEB 1080p', isCutoff: true, members: ['WEBDL-1080p', 'WEBRip-1080p'] },
      { name: 'SDTV', isCutoff: false, members: [] },
    ]);
    expect(summary.cutoff).toBe('WEB 1080p');
  });

  it('puts non-zero format scores first, highest first, then the zero ones by name', () => {
    expect(summarizeQualityProfile(PROFILE).formats).toEqual([
      { name: 'AMZN', score: 50 },
      { name: 'Repack', score: 50 },
      { name: 'BR-DISK', score: -10000 },
      { name: 'Anime', score: 0 },
      { name: 'x265', score: 0 },
    ]);
  });

  it('keeps the score settings and the language, and nulls what the app leaves out', () => {
    const summary = summarizeQualityProfile(PROFILE);
    expect(summary).toMatchObject({ upgradeAllowed: true, minFormatScore: -100, cutoffFormatScore: 500, minUpgradeFormatScore: 1, language: null });

    const bare = summarizeQualityProfile({ id: 1, name: 'Lossless', cutoff: 42, items: [] });
    expect(bare).toEqual({
      id: 1, name: 'Lossless', upgradeAllowed: false, cutoff: null, qualities: [],
      minFormatScore: null, cutoffFormatScore: null, minUpgradeFormatScore: null, language: null, formats: [],
    });
    expect(summarizeQualityProfile({ ...PROFILE, language: { id: 1, name: 'English' } }).language).toBe('English');
  });

  it('names a cutoff that is not allowed, and a format the app sent without a name', () => {
    const summary = summarizeQualityProfile({
      ...PROFILE,
      cutoff: 19,
      formatItems: [{ format: 12, score: 5 }],
    });
    expect(summary.cutoff).toBe('Bluray-2160p');
    expect(summary.qualities.some((quality) => quality.isCutoff)).toBe(false);
    expect(summary.formats).toEqual([{ name: 'Format 12', score: 5 }]);
  });
});
