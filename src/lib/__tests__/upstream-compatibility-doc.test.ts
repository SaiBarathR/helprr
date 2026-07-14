import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const compatibility = readFileSync(
  path.join(root, 'docs/upstream-compatibility.md'),
  'utf8',
);
const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
const workflow = readFileSync(
  path.join(root, 'docs/maintainer-development-release-workflow.md'),
  'utf8',
);
const schema = readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');

function serviceTypesFromSchema(): string[] {
  const enumBody = /enum ServiceType \{([\s\S]*?)\}/.exec(schema)?.[1];
  if (!enumBody) throw new Error('ServiceType enum was not found');
  return enumBody
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);
}

describe('upstream compatibility documentation', () => {
  it('contains exactly one reference row for every configured service type', () => {
    const documentedTypes = [...compatibility.matchAll(/^\| `([A-Z]+)` \|/gm)]
      .map((match) => match[1]);

    expect(documentedTypes).toHaveLength(new Set(documentedTypes).size);
    expect([...documentedTypes].sort()).toEqual(serviceTypesFromSchema().sort());
  });

  it('matches the API namespaces implemented by the service clients', () => {
    const contracts = [
      ['SONARR', 'src/lib/sonarr-client.ts', '/api/v3/system/status', 'REST `/api/v3`'],
      ['RADARR', 'src/lib/radarr-client.ts', '/api/v3/system/status', 'REST `/api/v3`'],
      ['LIDARR', 'src/lib/lidarr-client.ts', '/api/v1/system/status', 'REST `/api/v1`'],
      ['QBITTORRENT', 'src/lib/qbittorrent-client.ts', '/api/v2/app/version', 'Web API `/api/v2`'],
      ['PROWLARR', 'src/lib/prowlarr-client.ts', '/api/v1/system/status', 'REST `/api/v1`'],
      ['JELLYFIN', 'src/lib/jellyfin-client.ts', '/System/Info', '`/System/Info`'],
      ['TMDB', 'src/lib/tmdb-client.ts', '/configuration', 'Hosted API `v3`'],
      ['ANILIST', 'src/lib/anilist-client.ts', 'https://graphql.anilist.co', '`graphql.anilist.co`'],
      ['SEERR', 'src/lib/seerr-client.ts', '/api/v1', 'REST `/api/v1`'],
    ] as const;

    for (const [type, sourcePath, sourceContract, documentedContract] of contracts) {
      const source = readFileSync(path.join(root, sourcePath), 'utf8');
      expect(source, `${type} client contract`).toContain(sourceContract);
      expect(compatibility, `${type} documented contract`).toContain(documentedContract);
    }
  });

  it('records the live point versions without presenting them as supported ranges', () => {
    for (const version of [
      '4.0.19.2979',
      '6.2.1.10461',
      '3.1.2.4913',
      'v5.1.4',
      '2.4.0.5397',
      '10.11.11',
      '3.3.0',
    ]) {
      expect(compatibility).toContain(`\`${version}\``);
    }

    expect(compatibility).toContain('Last verified: **2026-07-14**');
    expect(compatibility).toContain('No minimum or maximum upstream version is claimed yet.');
    expect(compatibility).toMatch(/must not be read as a supported product-version\s+range/);
  });

  it('links the user and maintainer workflows to the compatibility record', () => {
    expect(readme).toContain('[upstream compatibility matrix](docs/upstream-compatibility.md)');
    expect(workflow).toContain('[Upstream compatibility](upstream-compatibility.md)');
    expect(workflow).toContain('never infer an inclusive range');
  });
});
