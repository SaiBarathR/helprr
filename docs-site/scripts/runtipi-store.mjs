// Writes Helprr's Runtipi app store (github.com/SaiBarathR/helprr-runtipi) for a release,
// from the release's docker-compose.yml. Run from docs-site/:
//   node scripts/runtipi-store.mjs <store checkout> <version, such as 1.13.0>
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtipiCompose } from '../src/lib/app-store-compose.mjs';

const [store, version] = process.argv.slice(2);
if (!store || !/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Usage: node scripts/runtipi-store.mjs <store checkout> <version, such as 1.13.0>');
  process.exit(2);
}
const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const release = readFileSync(here('../../docker-compose.yml'), 'utf8');
const [major, minor, patch] = version.split('.').map(Number);
if (minor > 999 || patch > 999) throw new Error(`version ${version} does not fit tipi_version`);

const app = join(store, 'apps', 'helprr');
const tipiVersion = major * 1_000_000 + minor * 1_000 + patch;
// Runtipi offers an update only when tipi_version grows: never write an older release.
const current = existsSync(join(app, 'config.json')) ? JSON.parse(readFileSync(join(app, 'config.json'), 'utf8')) : null;
if (current && current.tipi_version >= tipiVersion) throw new Error(`the store already has ${current.version}; ${version} would not be offered as an update`);
mkdirSync(join(app, 'metadata'), { recursive: true });
writeFileSync(join(app, 'docker-compose.yml'), runtipiCompose(release, version));
writeFileSync(join(app, 'config.json'), `${JSON.stringify({
  name: 'Helprr',
  id: 'helprr',
  available: true,
  short_desc: 'Sonarr, Radarr, qBittorrent and Jellyfin in one app on your phone.',
  author: 'SaiBarathR',
  port: 3050,
  categories: ['media'],
  description: 'Helprr brings your media apps into one web app you install on your phone, with push notifications.',
  // One per release, in version order.
  tipi_version: tipiVersion,
  version,
  source: 'https://github.com/SaiBarathR/helprr',
  website: 'https://saibarathr.github.io/helprr/',
  exposable: true,
  dynamic_config: true,
  supported_architectures: ['amd64', 'arm64'],
  form_fields: [],
  // Tested with Runtipi 4.12.0.
  min_tipi_version: '4.12.0',
}, null, 2)}\n`);
copyFileSync(here('../runtipi/description.md'), join(app, 'metadata', 'description.md'));
copyFileSync(here('../runtipi/logo.jpg'), join(app, 'metadata', 'logo.jpg'));
copyFileSync(here('../runtipi/README.md'), join(store, 'README.md'));
console.log(`Wrote Helprr ${version} to ${app}`);
