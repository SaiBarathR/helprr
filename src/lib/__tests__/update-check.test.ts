import { describe, expect, it, vi } from 'vitest';
import {
  checkForUpdates,
  compareSemanticVersions,
  fetchLatestStableRelease,
  parseSemanticVersion,
} from '@/lib/update-check';

describe('update checks', () => {
  it('parses release, prerelease, v-prefix, and build metadata versions', () => {
    expect(parseSemanticVersion('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
    expect(parseSemanticVersion('v1.2.3-rc.4+build.8')?.prerelease).toEqual(['rc', '4']);
    expect(parseSemanticVersion('development')).toBeNull();
    expect(parseSemanticVersion('1.02.3')).toBeNull();
    expect(parseSemanticVersion('1.2')).toBeNull();
  });

  it('orders semantic versions including stable releases after prereleases', () => {
    const version = (value: string) => parseSemanticVersion(value)!;
    expect(compareSemanticVersions(version('1.1.0'), version('1.0.9'))).toBeGreaterThan(0);
    expect(compareSemanticVersions(version('1.0.0'), version('1.0.0-rc.1'))).toBeGreaterThan(0);
    expect(compareSemanticVersions(version('1.0.0-rc.2'), version('1.0.0-rc.10'))).toBeLessThan(0);
    expect(compareSemanticVersions(version('2.0.0'), version('2.0.0'))).toBe(0);
  });

  it('reports a newer stable release without trusting a remote URL', async () => {
    const result = await checkForUpdates('1.0.0', {
      now: () => new Date('2026-07-14T12:00:00.000Z'),
      loadLatestRelease: async () => ({
        version: '1.1.0',
        tagName: 'v1.1.0',
        publishedAt: '2026-07-13T00:00:00.000Z',
      }),
    });

    expect(result).toEqual({
      status: 'update_available',
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      releaseUrl: 'https://github.com/saibarathr/helprr/releases/tag/v1.1.0',
      publishedAt: '2026-07-13T00:00:00.000Z',
      checkedAt: '2026-07-14T12:00:00.000Z',
    });
  });

  it('does not make an outbound check for development/edge builds', async () => {
    const loadLatestRelease = vi.fn();
    const result = await checkForUpdates('development', { loadLatestRelease });

    expect(result.status).toBe('development');
    expect(result.checkedAt).toBeNull();
    expect(loadLatestRelease).not.toHaveBeenCalled();
  });

  it('returns a non-sensitive unavailable state when GitHub cannot be reached', async () => {
    const result = await checkForUpdates('1.0.0', {
      loadLatestRelease: async () => { throw new Error('token=secret-network-detail'); },
    });

    expect(result.status).toBe('unavailable');
    expect(JSON.stringify(result)).not.toContain('secret-network-detail');
  });

  it('validates the bounded GitHub latest-release response', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      tag_name: 'v1.2.0',
      published_at: '2026-07-14T00:00:00.000Z',
      html_url: 'https://attacker.invalid/not-used',
    }), { status: 200 }));

    const release = await fetchLatestStableRelease(fetchImpl as typeof fetch);

    expect(release).toEqual({
      version: '1.2.0',
      tagName: 'v1.2.0',
      publishedAt: '2026-07-14T00:00:00.000Z',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/saibarathr/helprr/releases/latest',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('rejects malformed and oversized release responses', async () => {
    const malformed = vi.fn(async () => new Response(JSON.stringify({ tag_name: 'stable' })));
    await expect(fetchLatestStableRelease(malformed as typeof fetch)).rejects.toThrow(
      'semantic version',
    );

    const oversized = vi.fn(async () => new Response('x'.repeat(128_001)));
    await expect(fetchLatestStableRelease(oversized as typeof fetch)).rejects.toThrow('too large');
  });
});
