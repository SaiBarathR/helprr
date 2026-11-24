import { describe, expect, it } from 'vitest';
import { buildActivityDigest } from './build-activity-digest';

const row = (eventType: string, body: string) => ({ eventType, body, metadata: { source: 'radarr' }, createdAt: new Date('2026-11-24T10:00:00Z') });

describe('activity digest', () => {
  it('counts upgrades apart from imports, and does not name them as highlights', () => {
    const digest = buildActivityDigest({
      period: 'daily',
      rows: [row('imported', 'Dune'), row('upgraded', 'WEBDL-1080p → Bluray-2160p: Arrival'), row('upgraded', 'Better WEBDL-2160p: Heat')],
    });
    expect(digest.body).toContain('1 import · 2 upgrades');
    expect(digest.body).toContain('Dune');
    expect(digest.body).not.toContain('Arrival');
  });

  it('counts titles added and deleted and files deleted, and names Prowlarr', () => {
    const digest = buildActivityDigest({
      period: 'daily',
      rows: [
        row('titleAdded', 'Pluribus (2025)'),
        { ...row('titleAdded', '5 Movies Added'), metadata: { source: 'radarr', grouped: true, groupCount: 5 } },
        row('titleDeleted', 'Monster (2004)'),
        row('fileDeleted', 'Monster S01E03 (Bluray-720p): deleted'),
        { ...row('arrUpdateAvailable', 'Prowlarr 3.1.0.5799 is out'), metadata: { source: 'prowlarr' } },
      ],
    });
    expect(digest.body).toContain('6 titles added · 1 title deleted · 1 file deleted');
    expect(digest.body).toContain('1 Prowlarr');
  });
});
