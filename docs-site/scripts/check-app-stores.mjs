// The CasaOS and Runtipi files (src/lib/app-store-compose.mjs), checked against the
// release's docker-compose.yml with Compose itself: the same images, settings and
// checks, only the differences these dashboards need. Run from docs-site/:
//   node scripts/check-app-stores.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASAOS_DATA, casaosCompose, runtipiCompose, truenasCompose } from '../src/lib/app-store-compose.mjs';

const release = readFileSync(fileURLToPath(new URL('../../docker-compose.yml', import.meta.url)), 'utf8');
const docker = execFileSync('sh', ['-c', 'command -v docker'], { encoding: 'utf8' }).trim();
let failed = 0;

/** Compose's view of a file, with only `env` set (and PATH, HOME): JSON, or YAML for `as`. */
function config(text, env = {}, as = 'json') {
  const dir = mkdtempSync(join(tmpdir(), 'helprr-app-stores-'));
  try {
    writeFileSync(join(dir, 'docker-compose.yml'), text);
    const run = spawnSync(docker, ['compose', '-p', 'helprr', 'config', '--format', as], { cwd: dir, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, encoding: 'utf8' });
    if (run.status !== 0) throw new Error(run.stderr.trim());
    return as === 'json' ? JSON.parse(run.stdout) : run.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function check(label, test) {
  try {
    test();
    console.log(`ok   ${label}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${label}: ${error.message.split('\n')[0]}`);
  }
}

function same(actual, expected, what) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what}: ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}`);
}

const base = config(release);
// The release's services, less the optional worker (behind a profile, so not in Compose's view).
const SERVICES = Object.keys(base.services).sort();
// Kept the same as the release: everything about a service except where its data lives.
const KEYS = ['image', 'user', 'entrypoint', 'command', 'environment', 'healthcheck', 'network_mode', 'stop_grace_period', 'extra_hosts', 'container_name'];
const targets = (service) => (service.volumes ?? []).map((volume) => volume.target).sort();

/** What both dashboards share: the release's services, with their data in folders. */
function commonChecks(name, out, dataRoot, initHealthy) {
  check(`${name}: Helprr, its database, Redis and helprr-init`, () => same(Object.keys(out.services).sort(), SERVICES, 'services'));
  check(`${name}: no Docker volumes, data under ${dataRoot}`, () => {
    if (Object.keys(out.volumes ?? {}).length) throw new Error(`volumes ${Object.keys(out.volumes)}`);
    for (const [service, value] of Object.entries(out.services)) {
      for (const volume of value.volumes ?? []) if (volume.type !== 'bind' || !volume.source.startsWith(dataRoot)) throw new Error(`${service} ${volume.source}`);
    }
  });
  check(`${name}: the same mounts, less logs and the image cache`, () => {
    for (const service of SERVICES) {
      const expected = targets(base.services[service]).filter((target) => !['/app/logs', '/app/image-cache'].includes(target));
      same(targets(out.services[service]), expected, `${service} mounts`);
    }
  });
  check(`${name}: Helprr's settings as in the release`, () => {
    for (const key of KEYS) {
      if (key === 'environment' || key === 'image') continue;
      same(out.services.helprr[key], base.services.helprr[key], `helprr ${key}`);
    }
    const environment = { ...base.services.helprr.environment };
    if (name === 'runtipi') environment.TZ = 'Europe/London';
    same(out.services.helprr.environment, environment, 'helprr environment');
  });
  check(`${name}: helprr-init as in the release, kept up only for Runtipi`, () => {
    for (const key of KEYS) if (!(initHealthy && ['entrypoint', 'healthcheck'].includes(key)) && key !== 'image') same(out.services['helprr-init'][key], base.services['helprr-init'][key], `helprr-init ${key}`);
    const waits = Object.values(out.services).flatMap((service) => Object.entries(service.depends_on ?? {}).filter(([on]) => on === 'helprr-init').map(([, rule]) => rule.condition));
    same([...new Set(waits)], [initHealthy ? 'service_healthy' : 'service_completed_successfully'], 'waiting for helprr-init');
  });
  check(`${name}: the same networks, restart policies and waits`, () => {
    for (const service of SERVICES) {
      same(Object.keys(out.services[service].networks ?? {}).sort(), Object.keys(base.services[service].networks ?? {}).sort(), `${service} networks`);
      same(Object.keys(out.services[service].depends_on ?? {}).sort(), Object.keys(base.services[service].depends_on ?? {}).sort(), `${service} waits for`);
      if (service !== 'helprr-init') same(out.services[service].restart, base.services[service].restart, `${service} restart`);
    }
  });
  check(`${name}: the database and Redis read helprr-init's passwords`, () => {
    const db = out.services['helprr-db'];
    same(db.environment.POSTGRES_PASSWORD_FILE, '/helprr-auth/postgres_password', 'POSTGRES_PASSWORD_FILE');
    same(db.environment.POSTGRES_PASSWORD, undefined, 'POSTGRES_PASSWORD');
    for (const key of ['image', 'command', 'healthcheck']) same(db[key], base.services['helprr-db'][key], `helprr-db ${key}`);
    for (const key of ['image', 'environment']) same(out.services['helprr-redis'][key], key === 'environment' ? undefined : base.services['helprr-redis'][key], `helprr-redis ${key}`);
    const command = out.services['helprr-redis'].command.join('\n');
    if (!command.includes('/helprr-auth/redis_password')) throw new Error('Redis does not read its password file');
    // Everything in the release's command but its password lines is kept, such as Redis's options.
    const kept = base.services['helprr-redis'].command.join('\n').split('\n').filter((line) => line.trim() && !line.trim().startsWith('#') && !line.includes('REDIS_PASSWORD'));
    for (const line of kept) if (!command.includes(line)) throw new Error(`Redis lost: ${line.trim()}`);
    const { test: _test, ...health } = out.services['helprr-redis'].healthcheck;
    const { test: _baseTest, ...baseHealth } = base.services['helprr-redis'].healthcheck;
    same(health, baseHealth, 'Redis health check timing');
  });
}

// CasaOS: the file as pasted, then as CasaOS saves it (already resolved) and Compose
// runs it: no ${...} or $ left for either to change.
const casaos = casaosCompose(release);
check('casaos: no variables', () => {
  if (/\$[$A-Za-z_{]/.test(casaos)) throw new Error('a $ is left');
});
const casaosConfig = config(casaos);
check('casaos: the same after CasaOS saves it again', () => same(config(config(casaos, {}, 'yaml')), casaosConfig, 'resolved twice'));
commonChecks('casaos', casaosConfig, CASAOS_DATA, false);
check('casaos: helprr-init restarts only on failure', () => same(casaosConfig.services['helprr-init'].restart, 'on-failure', 'restart'));
check('casaos: CasaOS opens Helprr at its port', () => {
  const meta = casaosConfig['x-casaos'];
  same([meta.main, meta.port_map, String(casaosConfig.services.helprr.ports[0].published)], ['helprr', '3050', '3050'], 'x-casaos');
});

// TrueNAS: the same, in the reader's dataset; a pool name that is not one is refused.
const truenas = truenasCompose(release, 'tank');
check('truenas: no variables', () => {
  if (/\$[$A-Za-z_{]/.test(truenas)) throw new Error('a $ is left');
});
commonChecks('truenas', config(truenas), '/mnt/tank/helprr', false);
check('truenas: only pool names', () => {
  for (const pool of ['tank', 'Pool_1', 'my.pool']) truenasCompose(release, pool);
  for (const pool of ['', '1tank', 'tank/x', 'a b', '../etc']) {
    let refused = false;
    try { truenasCompose(release, pool); } catch { refused = true; }
    if (!refused) throw new Error(`accepted ${JSON.stringify(pool)}`);
  }
});

// Runtipi: with the variables Runtipi sets.
const runtipi = runtipiCompose(release, '1.13.0');
const runtipiConfig = config(runtipi, { APP_DATA_DIR: '/runtipi/app-data/helprr', TZ: 'Europe/London' });
commonChecks('runtipi', runtipiConfig, '/runtipi/app-data/helprr/data', true);
check('runtipi: one exact version, its port left to Runtipi', () => {
  same(runtipiConfig.services.helprr.image, 'ghcr.io/saibarathr/helprr:1.13.0', 'helprr image');
  same(runtipiConfig.services['helprr-init'].image, 'ghcr.io/saibarathr/helprr:1.13.0', 'helprr-init image');
  same(runtipiConfig.services.helprr.ports, undefined, 'ports');
  // Compose leaves a service's x- keys out of its view: read them from the file.
  if (!runtipi.includes('\n  helprr:\n    x-runtipi:\n      is_main: true\n      internal_port: 3050\n')) throw new Error('helprr is not Runtipi\'s main service on 3050');
  if (!runtipi.endsWith('x-runtipi:\n  schema_version: 2\n')) throw new Error('no schema_version 2');
});
check('runtipi: only its own variables', () => {
  const left = [...runtipi.matchAll(/\$\{([A-Z_]+)\}/g)].map((match) => match[1]);
  same([...new Set(left)].sort(), ['APP_DATA_DIR', 'TZ'], 'variables');
  if (/\$\$|\$[A-Za-z_]/.test(runtipi)) throw new Error('a $ is left');
});

console.log(failed ? `${failed} checks failed.` : 'The CasaOS, Runtipi and TrueNAS files match the release.');
process.exit(failed ? 1 : 0);
