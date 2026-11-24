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
});
