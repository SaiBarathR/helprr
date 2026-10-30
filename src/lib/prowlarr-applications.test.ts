import { describe, expect, it } from 'vitest';
import { findUnsyncedConnections, toApplicationSummary } from '@/lib/prowlarr-applications';
import type { ProwlarrApplication } from '@/lib/prowlarr-client';

const app = (implementation: string, baseUrl: string): ProwlarrApplication => ({
  id: 1,
  name: implementation,
  implementation,
  implementationName: implementation,
  syncLevel: 'fullSync',
  enable: true,
  fields: [{ name: 'baseUrl', value: baseUrl }, { name: 'apiKey', value: 'secret-key' }],
});

describe('findUnsyncedConnections', () => {
  it('matches an arr reached by another name on the same port', () => {
    const missing = findUnsyncedConnections(
      [{ type: 'SONARR', url: 'http://100.1.1.1:8989', label: 'Sonarr' }],
      [app('Sonarr', 'http://sonarr:8989')],
    );

    expect(missing).toEqual([]);
  });

  it('flags a second instance Prowlarr does not sync, by its label', () => {
    const missing = findUnsyncedConnections(
      [
        { type: 'SONARR', url: 'http://host:8989', label: 'Sonarr' },
        { type: 'SONARR', url: 'http://host:8990', label: 'sonarr-anime' },
      ],
      [app('Sonarr', 'http://sonarr:8989')],
    );

    expect(missing).toEqual([{ type: 'SONARR', label: 'sonarr-anime' }]);
  });

  it('does not match another app type on the same port', () => {
    expect(findUnsyncedConnections(
      [{ type: 'RADARR', url: 'http://host:8989' }],
      [app('Sonarr', 'http://sonarr:8989')],
    )).toEqual([{ type: 'RADARR', label: 'Radarr' }]);
  });

  it('ignores services Prowlarr does not sync to', () => {
    expect(findUnsyncedConnections([{ type: 'JELLYFIN', url: 'http://host:8096' }], [])).toEqual([]);
  });

  it('treats an unreadable address as not synced', () => {
    expect(findUnsyncedConnections([{ type: 'LIDARR', url: 'not a url' }], [app('Lidarr', 'also bad')])).toHaveLength(1);
  });
});

describe('toApplicationSummary', () => {
  it('drops the fields holding the API key', () => {
    expect(JSON.stringify(toApplicationSummary(app('Sonarr', 'http://sonarr:8989')))).not.toMatch(/secret-key|fields|baseUrl/);
  });
});
