// Helprr's Compose file for app dashboards that read a Compose file as it is: no .env,
// no ${...} variables, and folders on the host instead of Docker volumes (CasaOS,
// Runtipi).
// Made from the release's docker-compose.yml at build time, so it follows every
// release; scripts/check-app-stores.mjs checks it against that file with Compose.

/** Where CasaOS keeps apps' data. */
export const CASAOS_DATA = '/DATA/AppData/helprr';
/** Where Runtipi keeps an app's data: its own variable, which it sets. */
export const RUNTIPI_DATA = '${APP_DATA_DIR}/data';

// Kept in the container: a cache, and logs that `docker logs` also has.
const NOT_KEPT = ['helprr-logs', 'helprr-image-cache'];

/** Every ${NAME:-default}, ${NAME:+value} and ${NAME} as Compose resolves it with nothing set. */
export function withDefaults(text) {
  const variable = /(?<!\$)\$\{[A-Za-z_][A-Za-z0-9_]*(?:(:-)([^${}]*))?(?::\+[^${}]*)?\}/g;
  // Innermost first: a default can be another variable.
  for (let out = text; ;) {
    const next = out.replace(variable, (_, dash, fallback) => (dash ? fallback : ''));
    if (next === out) return out;
    out = next;
  }
}

// CasaOS resolves ${...} and $$ each time it saves the file (installing, and every
// Settings → Save), and Compose again as it runs it, so a shell's $NAME never survives.
// The database and Redis read their passwords from helprr-init's files with no $NAME:
// Postgres by POSTGRES_PASSWORD_FILE, Redis and its health check by $(cat ...), which
// Compose leaves alone.
const DB_PASSWORD_FILE = '      - POSTGRES_PASSWORD_FILE=/helprr-auth/postgres_password';
const REDIS_REQUIREPASS = "        requirepass \"$(sed 's/[\\\\\"]/\\\\&/g' /helprr-auth/redis_password)\"";
const REDIS_HEALTH = '      test: [ "CMD-SHELL", "REDISCLI_AUTH=\\"$(cat /helprr-auth/redis_password)\\" redis-cli ping | grep -q PONG" ]';

/** Lines from `from` (a line) to the next line indented no deeper than `indent`. */
function blockEnd(lines, from, indent) {
  let end = from + 1;
  while (end < lines.length && (lines[end] === '' || lines[end].startsWith(' '.repeat(indent + 1)) || lines[end].startsWith(`${' '.repeat(indent)}- `))) end += 1;
  return end;
}

/** Replaces the block that starts with `key` inside `service` with `replacement` lines. */
function replaceBlock(lines, service, key, replacement) {
  const start = lines.indexOf(`  ${service}:`);
  const at = lines.findIndex((line, index) => index > start && line === `    ${key}:`);
  const next = lines.findIndex((line, index) => index > start && /^  [a-z]/.test(line));
  if (start < 0 || at < 0 || (next > 0 && at > next)) throw new Error(`docker-compose.yml has no ${key} in ${service}`);
  lines.splice(at, blockEnd(lines, at, 4) - at, ...replacement);
}

/** Replaces one exact line, which must be there. */
function replaceLine(lines, old, replacement) {
  const at = lines.indexOf(old);
  if (at < 0) throw new Error(`docker-compose.yml has no line ${old.trim()}`);
  lines.splice(at, 1, ...replacement);
}

/** The release file for a dashboard: Helprr, its database, Redis and its secrets, written out. */
function dashboardCompose(release, dataDir) {
  const lines = release.split('\n');
  // The optional Twitch and YouTube worker needs a library folder and a profile: left out.
  const workerStart = lines.findIndex((line) => line === '  helprr-worker-init:');
  const networks = lines.findIndex((line) => line === 'networks:');
  const volumes = lines.findIndex((line) => line === 'volumes:');
  if (workerStart < 0 || networks < workerStart || volumes < networks) throw new Error('docker-compose.yml is not laid out as expected');
  // Only the worker's two services may go: a new one there must be added here on purpose.
  const left = lines.slice(workerStart, networks).filter((line) => /^  [a-z][a-z0-9-]*:$/.test(line));
  if (left.join() !== '  helprr-worker-init:,  helprr-twitch-worker:') throw new Error(`docker-compose.yml has services after the worker: ${left.join(' ').trim()}`);
  let start = workerStart;
  while (lines[start - 1].startsWith('  #')) start -= 1;
  const kept = [...lines.slice(0, start), ...lines.slice(networks, volumes)]
    // Comments talk about .env, which CasaOS does not have.
    .filter((line) => !/^\s*#/.test(line))
    .filter((line) => !NOT_KEPT.some((name) => line.trimStart().startsWith(`- ${name}:`)))
    // A named volume becomes a folder: helprr-db-data -> /DATA/AppData/helprr/db-data.
    .map((line) => line.replace(/^(\s+- )helprr-([a-z-]+):/, `$1${dataDir}/$2:`))
    // CasaOS has no "no" restart policy and makes it unless-stopped, which restarts
    // helprr-init after it finishes, so nothing that waits for it ever starts.
    .map((line) => (line === '    restart: "no"' ? '    restart: on-failure' : line));

  replaceBlock(kept, 'helprr-db', 'entrypoint', []);
  replaceLine(kept, '      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-}', [DB_PASSWORD_FILE]);
  // Redis's command, less the lines that read REDIS_PASSWORD: the file has the password.
  const redis = kept.indexOf('  helprr-redis:');
  const passwordChecks = kept.filter((line, index) => index > redis && /^\s+\[ -n "\$\$REDIS_PASSWORD" \]/.test(line)).length;
  const requirepass = kept.findIndex((line, index) => index > redis && /^\s+requirepass /.test(line));
  if (redis < 0 || passwordChecks !== 2 || requirepass < 0) throw new Error('docker-compose.yml starts Redis differently');
  kept.splice(requirepass, 1, REDIS_REQUIREPASS);
  for (let index = kept.length - 1; index > redis; index -= 1) if (/^\s+\[ -n "\$\$REDIS_PASSWORD" \]/.test(kept[index])) kept.splice(index, 1);
  replaceLine(kept, '      - REDIS_PASSWORD=${REDIS_PASSWORD:-}', []);
  // Redis's environment had only that line.
  const empty = kept.findIndex((line, index) => line === '    environment:' && !kept[index + 1].startsWith('      '));
  if (empty >= 0) kept.splice(empty, 1);
  const health = kept.findIndex((line) => line.includes('redis-cli ping'));
  if (health < 0) throw new Error('docker-compose.yml has no Redis health check');
  kept.splice(health, 1, REDIS_HEALTH);

  const body = withDefaults(kept.join('\n'));
  if (/\$[$A-Za-z_{]/.test(body)) throw new Error('the file still has a $ that a dashboard would resolve');
  return body.replace(/\n+$/, '\n');
}

/** For CasaOS: pasted into Install a customized app → Import. */
export function casaosCompose(release) {
  return `name: helprr
${dashboardCompose(release, CASAOS_DATA)}
x-casaos:
  main: helprr
  index: /
  port_map: "3050"
  scheme: http
  title:
    en_US: Helprr
  tagline:
    en_US: Your media apps, in one place on your phone
  icon: https://raw.githubusercontent.com/SaiBarathR/helprr/main/public/icons/icon-192.png
  author: SaiBarathR
  developer: SaiBarathR
  category: Media
  architectures:
    - amd64
    - arm64
`;
}

// Runtipi counts an app with a stopped container as stopped, and starts only running
// apps when the machine starts. So helprr-init stays up once it has made the secrets,
// and the others wait for it to be healthy instead of finished.
const RUNTIPI_INIT = [
  '    entrypoint:',
  '      - /bin/sh',
  '      - -c',
  '      - |',
  '        rm -f /tmp/helprr-init-done',
  '        /bin/sh /app/init-secrets.sh || exit 1',
  '        touch /tmp/helprr-init-done',
  '        trap "exit 0" TERM',
  '        while true; do sleep 3600 & wait; done',
  '    restart: unless-stopped',
  '    healthcheck:',
  '      test: ["CMD", "test", "-f", "/tmp/helprr-init-done"]',
  '      interval: 30s',
  '      timeout: 5s',
  '      retries: 3',
  '      start_period: 5m',
  '      start_interval: 2s',
];

/**
 * For Runtipi: its app store's docker-compose.yml, on one exact Helprr version (an update
 * is a new version in the store). Runtipi publishes Helprr's port and sets TZ itself.
 */
export function runtipiCompose(release, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`not a release version: ${version}`);
  const lines = dashboardCompose(release, '@DATA@')
    .replaceAll('ghcr.io/saibarathr/helprr:stable', `ghcr.io/saibarathr/helprr:${version}`)
    .split('\n');
  const tz = lines.indexOf('      - TZ=UTC');
  if (tz < 0) throw new Error('docker-compose.yml sets TZ differently');
  lines[tz] = '      - TZ=@TZ@';
  const entrypoint = lines.indexOf('    entrypoint: ["/bin/sh", "/app/init-secrets.sh"]');
  const restart = lines.indexOf('    restart: on-failure');
  if (entrypoint < 0 || restart !== entrypoint + 1) throw new Error('docker-compose.yml runs helprr-init differently');
  lines.splice(entrypoint, 2, ...RUNTIPI_INIT);
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (lines[index] === '      helprr-init:' && lines[index + 1] === '        condition: service_completed_successfully') lines[index + 1] = '        condition: service_healthy';
  }
  const ports = lines.indexOf('    ports:');
  if (ports < 0 || !lines[ports + 1].startsWith('      - ')) throw new Error('docker-compose.yml has no ports for helprr');
  lines.splice(ports, 2);
  const main = lines.indexOf('  helprr:');
  lines.splice(main + 1, 0, '    x-runtipi:', '      is_main: true', '      internal_port: 3050');
  return `${lines.join('\n').replaceAll('@DATA@', RUNTIPI_DATA).replace('@TZ@', '${TZ}')}
x-runtipi:
  schema_version: 2
`;
}
