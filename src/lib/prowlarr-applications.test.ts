import { describe, expect, it } from 'vitest';
import { buildNewApplication, findUnsyncedConnections, guessProwlarrUrl, hasApplicationAt, toApplicationSummary } from '@/lib/prowlarr-applications';
import type { ProwlarrApplication } from '@/lib/prowlarr-client';

const app = (implementation: string, baseUrl: string): ProwlarrApplication => ({
  id: 1,
  name: implementation,
  implementation,
  implementationName: implementation,
  syncLevel: 'fullSync',
  enable: true,
  tags: [3],
  fields: [{ name: 'baseUrl', value: baseUrl }, { name: 'apiKey', value: 'secret-key' }],
});

describe('findUnsyncedConnections', () => {
  it('pairs an arr reached by another name on the same port', () => {
    expect(findUnsyncedConnections(
      [{ id: 'c1', type: 'SONARR', url: 'http://100.1.1.1:8989', label: 'Sonarr' }],
      [app('Sonarr', 'http://sonarr:8989')],
    )).toEqual([]);
  });

  it('accepts one arr behind a proxy name when an app is left to explain it', () => {
    expect(findUnsyncedConnections(
      [{ id: 'c2', type: 'SONARR', url: 'https://sonarr.example', label: 'Sonarr' }],
      [app('Sonarr', 'http://sonarr:8989')],
    )).toEqual([]);
  });

  it('flags a second instance on another port, by its label', () => {
    expect(findUnsyncedConnections(
      [
        { id: 'c3', type: 'SONARR', url: 'http://host:8989', label: 'Sonarr' },
        { id: 'c4', type: 'SONARR', url: 'http://host:8990', label: 'sonarr-anime' },
      ],
      [app('Sonarr', 'http://sonarr:8989')],
    )).toEqual([{ id: 'c4', type: 'SONARR', label: 'sonarr-anime' }]);
  });

  it('does not let one app cover two hosts on the same port', () => {
    const missing = findUnsyncedConnections(
      [
        { id: 'c5', type: 'SONARR', url: 'http://host-a:8989', label: 'A' },
        { id: 'c6', type: 'SONARR', url: 'http://host-b:8989', label: 'B' },
      ],
      [app('Sonarr', 'http://host-a:8989')],
    );

    expect(missing).toEqual([{ id: 'c6', type: 'SONARR', label: 'B' }]);
  });

  it('tells proxied paths apart', () => {
    const missing = findUnsyncedConnections(
      [
        { id: 'c7', type: 'SONARR', url: 'https://proxy/sonarr-a', label: 'A' },
        { id: 'c8', type: 'SONARR', url: 'https://proxy/sonarr-b', label: 'B' },
      ],
      [app('Sonarr', 'https://proxy/sonarr-a/')],
    );

    expect(missing).toEqual([{ id: 'c8', type: 'SONARR', label: 'B' }]);
  });

  it('does not match another app type on the same port', () => {
    expect(findUnsyncedConnections(
      [{ id: 'c9', type: 'RADARR', url: 'http://host:8989' }],
      [app('Sonarr', 'http://sonarr:8989')],
    )).toEqual([{ id: 'c9', type: 'RADARR', label: 'Radarr' }]);
  });

  it('ignores services Prowlarr does not sync to', () => {
    expect(findUnsyncedConnections([{ id: 'c10', type: 'JELLYFIN', url: 'http://host:8096' }], [])).toEqual([]);
  });

  it('flags a connection with no app, even with an unreadable address', () => {
    expect(findUnsyncedConnections([{ id: 'c11', type: 'LIDARR', url: 'not a url' }], [])).toHaveLength(1);
  });
});

describe('toApplicationSummary', () => {
  it('drops the fields holding the API key', () => {
    expect(JSON.stringify(toApplicationSummary(app('Sonarr', 'http://sonarr:8989')))).not.toMatch(/secret-key|fields|baseUrl/);
  });

  it('keeps the tag ids so the Apps tab can name them', () => {
    expect(toApplicationSummary(app('Sonarr', 'http://sonarr:8989')).tags).toEqual([3]);
  });
});

describe('Add to Prowlarr helpers', () => {
  const template = {
    implementation: 'Radarr',
    implementationName: 'Radarr',
    configContract: 'RadarrSettings',
    fields: [{ name: 'prowlarrUrl', value: 'http://localhost:9696' }, { name: 'baseUrl', value: 'http://localhost:7878' }, { name: 'apiKey' }, { name: 'syncCategories', value: [2000] }],
  };
  const input = { name: 'Radarr 4K', syncLevel: 'fullSync' as const, prowlarrUrl: 'http://prowlarr:9696', baseUrl: 'http://radarr4k:7878', apiKey: 'k' };

  it('fills the addresses and key into Prowlarr’s form and keeps its other defaults', () => {
    expect(buildNewApplication(template, input)?.fields).toEqual([
      { name: 'prowlarrUrl', value: 'http://prowlarr:9696' },
      { name: 'baseUrl', value: 'http://radarr4k:7878' },
      { name: 'apiKey', value: 'k' },
      { name: 'syncCategories', value: [2000] },
    ]);
  });

  it('builds nothing from a form without a field Helprr fills', () => {
    expect(buildNewApplication({ ...template, fields: template.fields.filter((field) => field.name !== 'apiKey') }, input)).toBeNull();
  });

  it('guesses the Prowlarr address most apps use, else Helprr’s', () => {
    const withUrl = (url: string) => ({ ...app('Sonarr', 'http://x:1'), fields: [{ name: 'prowlarrUrl', value: url }] });
    expect(guessProwlarrUrl([withUrl('http://a:9696'), withUrl('http://b:9696'), withUrl('http://b:9696')], 'http://helprr-view:9696')).toBe('http://b:9696');
    expect(guessProwlarrUrl([], 'http://helprr-view:9696/')).toBe('http://helprr-view:9696');
  });

  it('finds an app at the same address, by type', () => {
    const apps = [app('Sonarr', 'http://sonarr:8989/')];
    expect(hasApplicationAt(apps, 'Sonarr', 'http://sonarr:8989')).toBe(true);
    expect(hasApplicationAt(apps, 'Radarr', 'http://sonarr:8989')).toBe(false);
    expect(hasApplicationAt(apps, 'Sonarr', 'http://sonarr:8990')).toBe(false);
  });
});
