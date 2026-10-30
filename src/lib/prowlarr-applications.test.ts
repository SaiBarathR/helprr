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
  it('pairs an arr reached by another name on the same port', () => {
    expect(findUnsyncedConnections(
      [{ type: 'SONARR', url: 'http://100.1.1.1:8989', label: 'Sonarr' }],
      [app('Sonarr', 'http://sonarr:8989')],
    )).toEqual([]);
  });

  it('accepts one arr behind a proxy name when an app is left to explain it', () => {
    expect(findUnsyncedConnections(
      [{ type: 'SONARR', url: 'https://sonarr.example', label: 'Sonarr' }],
      [app('Sonarr', 'http://sonarr:8989')],
    )).toEqual([]);
  });

  it('flags a second instance on another port, by its label', () => {
    expect(findUnsyncedConnections(
      [
        { type: 'SONARR', url: 'http://host:8989', label: 'Sonarr' },
        { type: 'SONARR', url: 'http://host:8990', label: 'sonarr-anime' },
      ],
      [app('Sonarr', 'http://sonarr:8989')],
    )).toEqual([{ type: 'SONARR', label: 'sonarr-anime' }]);
  });

  it('does not let one app cover two hosts on the same port', () => {
    const missing = findUnsyncedConnections(
      [
        { type: 'SONARR', url: 'http://host-a:8989', label: 'A' },
        { type: 'SONARR', url: 'http://host-b:8989', label: 'B' },
      ],
      [app('Sonarr', 'http://host-a:8989')],
    );

    expect(missing).toEqual([{ type: 'SONARR', label: 'B' }]);
  });

  it('tells proxied paths apart', () => {
    const missing = findUnsyncedConnections(
      [
        { type: 'SONARR', url: 'https://proxy/sonarr-a', label: 'A' },
        { type: 'SONARR', url: 'https://proxy/sonarr-b', label: 'B' },
      ],
      [app('Sonarr', 'https://proxy/sonarr-a/')],
    );

    expect(missing).toEqual([{ type: 'SONARR', label: 'B' }]);
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

  it('flags a connection with no app, even with an unreadable address', () => {
    expect(findUnsyncedConnections([{ type: 'LIDARR', url: 'not a url' }], [])).toHaveLength(1);
  });
});

describe('toApplicationSummary', () => {
  it('drops the fields holding the API key', () => {
    expect(JSON.stringify(toApplicationSummary(app('Sonarr', 'http://sonarr:8989')))).not.toMatch(/secret-key|fields|baseUrl/);
  });
});
