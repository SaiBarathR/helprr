// The install configurator, checked the way a reader uses it: for every combination, its
// command block is run in an empty folder (curl and docker stand-ins; `docker compose up`
// becomes the real `docker compose config`), and the result is checked against what the
// tested guides need. Run from docs-site/: node scripts/check-configurator.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, RELEASE, combinations, generate, isLocalHostname, problems } from '../src/lib/configurator.mjs';

const releasePath = fileURLToPath(new URL('../../docker-compose.yml', import.meta.url));
const release = readFileSync(releasePath, 'utf8');
const realDocker = execFileSync('sh', ['-c', 'command -v docker'], { encoding: 'utf8' }).trim();

/** Runs a command block in a fresh folder; returns the folder, the exit code and Compose's view. */
function runBlock(commands, { networkExists = true, existingEnv = null, existingCompose = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'helprr-configurator-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  // Only the release's Compose file, saved under its own name (-O).
  writeFileSync(join(bin, 'curl'), `#!/bin/sh
case " $* " in *" -fsSLO ${RELEASE}/docker-compose.yml "*) cp "${releasePath}" docker-compose.yml ;; *) echo "unexpected curl $*" >&2; exit 2 ;; esac
`);
  writeFileSync(join(bin, 'docker'), `#!/bin/sh
case "$1 $2" in
  "network inspect") exit ${networkExists ? 0 : 1} ;;
  "compose up") exec "${realDocker}" compose config --format json > "${join(dir, 'config.json')}" ;;
esac
exit 2
`);
  chmodSync(join(bin, 'curl'), 0o755);
  chmodSync(join(bin, 'docker'), 0o755);
  const home = join(dir, 'home');
  mkdirSync(home);
  if (existingEnv !== null || existingCompose !== null) mkdirSync(join(home, 'helprr'));
  if (existingEnv !== null) writeFileSync(join(home, 'helprr', '.env'), existingEnv);
  if (existingCompose !== null) writeFileSync(join(home, 'helprr', 'docker-compose.yml'), existingCompose);
  const run = spawnSync('sh', ['-c', commands.join('\n')], { cwd: home, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
  const configFile = join(dir, 'config.json');
  return { dir, home, status: run.status, stdout: run.stdout, stderr: run.stderr, config: existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : null };
}

/** Portainer's way: the pasted file, with the variables table as its stack.env file. */
function runPortainer(out) {
  const dir = mkdtempSync(join(tmpdir(), 'helprr-configurator-'));
  writeFileSync(join(dir, 'docker-compose.yml'), out.compose);
  writeFileSync(join(dir, 'stack.env'), out.portainer.variables.map(({ name, value }) => `${name}=${value}\n`).join(''));
  // Nothing from this shell: only what the reader enters reaches Compose.
  const run = spawnSync(realDocker, ['compose', '-p', 'helprr', '--env-file', 'stack.env', 'config', '--format', 'json'], { cwd: dir, env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: 'utf8' });
  return { dir, status: run.status, stderr: run.stderr, config: run.status === 0 ? JSON.parse(run.stdout) : null };
}

function check(label, answers, assert) {
  try {
    assert(answers);
    console.log(`ok   ${label}`);
    return 0;
  } catch (error) {
    console.error(`FAIL ${label}: ${error.message.split('\n')[0]}`);
    return 1;
  }
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}

let failed = 0;
const all = combinations();
for (const answers of all) {
  failed += check(`${answers.system}/${answers.where}/${answers.access}`, answers, () => {
    const out = generate(answers, release);
    must(Object.keys(out.problems).length === 0, `refused its own sample answers: ${JSON.stringify(out.problems)}`);
    // Portainer pastes the file and takes the variables in a table: Compose sees them as
    // its environment. The terminal runs the block.
    const run = out.portainer ? runPortainer(out) : runBlock(out.commands);
    try {
      must(run.status === 0 && run.config, `the command block failed: ${run.stderr.trim()}`);
      const { services, networks } = run.config;
      const helprr = services.helprr;
      // Only Helprr joins the apps' network, and only when they are in their own stack.
      for (const [name, service] of Object.entries(services)) {
        const joined = Object.keys(service.networks ?? {}).includes('apps');
        must(joined === (answers.where === 'stack' && name === 'helprr'), `${name} ${joined ? 'joined' : 'did not join'} the apps' network`);
      }
      if (answers.where === 'stack') must(networks.apps.name === answers.network && networks.apps.external, 'the apps network is wrong');
      // Every .env line reaches Helprr.
      for (const line of out.env) {
        const [key, value] = [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)];
        must(helprr.environment[key] === value, `${key} did not reach helprr`);
      }
      // The first admin: Helprr accepts it at APP_ORIGIN when set, else at a home address.
      const origin = helprr.environment.APP_ORIGIN || null;
      must(origin ? out.open === origin && out.httpsFirst : out.open === `http://${answers.serverAddress}:3050` && !out.httpsFirst, `first admin at ${out.open} with APP_ORIGIN ${origin}`);
      if (!origin) must(isLocalHostname(new URL(out.open).hostname), `${out.open} is not an address Helprr creates the first admin at`);
      // Sonarr and Radarr always get an address to fetch .torrent files from.
      must(Boolean(helprr.environment.ARR_CALLBACK_ORIGIN), 'no ARR_CALLBACK_ORIGIN');
      // Portainer has no .env or terminal: its steps say where things go instead.
      if (out.portainer) must(!JSON.stringify(out.https.steps).includes('.env'), 'a Portainer step talks about .env');
    } finally {
      rmSync(run.dir, { recursive: true, force: true });
    }
  });
}

// An existing .env is never replaced: the block prints what to add, and stops before
// starting Helprr without it.
failed += check('an existing .env is left alone', { ...DEFAULTS, access: 'caddy' }, (answers) => {
  const out = generate(answers, release);
  const run = runBlock(out.commands, { existingEnv: 'MINE=1\n' });
  try {
    must(readFileSync(join(run.home, 'helprr', '.env'), 'utf8') === 'MINE=1\n', '.env was changed');
    must(run.status !== 0 && !run.config, 'it started Helprr anyway');
    for (const line of out.env) must(run.stdout.includes(line), `did not print ${line}`);
  } finally {
    rmSync(run.dir, { recursive: true, force: true });
  }
});

// Running it again keeps the previous Compose file.
failed += check('an existing docker-compose.yml is kept as .bak', DEFAULTS, (answers) => {
  const run = runBlock(generate(answers, release).commands, { existingCompose: 'services: {}\n' });
  try {
    must(run.status === 0 && readFileSync(join(run.home, 'helprr', 'docker-compose.yml.bak'), 'utf8') === 'services: {}\n', 'the old file was not kept');
  } finally {
    rmSync(run.dir, { recursive: true, force: true });
  }
});

// A missing network stops everything before a file is written.
failed += check('a missing apps network stops the block', { ...DEFAULTS, where: 'stack' }, (answers) => {
  const run = runBlock(generate(answers, release).commands, { networkExists: false });
  try {
    must(run.status !== 0 && !existsSync(join(run.home, 'helprr')), 'it went on without the network');
  } finally {
    rmSync(run.dir, { recursive: true, force: true });
  }
});

// Names YAML would otherwise read as something else, and Docker's own networks.
for (const network of ['true', '123', '1e3', 'null', 'media.net_1-a']) {
  failed += check(`network name ${network}`, { ...DEFAULTS, where: 'stack', network }, (answers) => {
    const run = runBlock(generate(answers, release).commands);
    try {
      must(run.status === 0 && run.config?.networks.apps.name === network, `gave ${JSON.stringify(run.config?.networks?.apps?.name)}: ${run.stderr.trim()}`);
    } finally {
      rmSync(run.dir, { recursive: true, force: true });
    }
  });
}
for (const serverAddress of ['nas.example.com', 'helprr.mydomain.org']) {
  failed += check(`server address ${serverAddress} is refused without a domain`, { ...DEFAULTS, serverAddress }, (answers) => must(problems(answers).serverAddress, 'accepted'));
}
for (const serverAddress of ['nas', 'nas.lan', 'nas.local', '10.0.0.5']) {
  failed += check(`server address ${serverAddress} is accepted`, { ...DEFAULTS, serverAddress }, (answers) => must(!problems(answers).serverAddress, problems(answers).serverAddress));
}
for (const network of ['bridge', 'host', 'none', 'bad name', '-x']) {
  failed += check(`network name ${JSON.stringify(network)} is refused`, { ...DEFAULTS, where: 'stack', network }, (answers) => must(problems(answers).network, 'accepted'));
}

console.log(failed ? `${failed} checks failed.` : `All ${all.length} combinations and the edge cases pass.`);
process.exit(failed ? 1 : 0);
