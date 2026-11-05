// The install configurator (docs-site/src/content/docs/install/configurator.mdx): three
// answers in, the reader's Compose file, .env lines, commands, app addresses and HTTPS
// steps out. Plain JavaScript, so the page and scripts/check-configurator.mjs (which runs
// `docker compose config` on every combination) use the same code. It writes no secrets:
// the Compose file's helprr-init makes them.

export const RELEASE = 'https://github.com/SaiBarathR/helprr/releases/latest/download';
const GUIDES = '/helprr/';

export const APPS = [
  { name: 'Sonarr', host: 'sonarr', port: 8989 },
  { name: 'Radarr', host: 'radarr', port: 7878 },
  { name: 'Lidarr', host: 'lidarr', port: 8686 },
  { name: 'qBittorrent', host: 'qbittorrent', port: 8080 },
  { name: 'Prowlarr', host: 'prowlarr', port: 9696 },
  { name: 'Jellyfin', host: 'jellyfin', port: 8096 },
  { name: 'Seerr', host: 'seerr', port: 5055 },
];

// Each Phase 7 platform adds itself here, with its tested guide.
export const SYSTEMS = { linux: 'Linux with Docker Compose' };

export const WHERE = {
  stack: 'In Docker on this machine, in their own Compose stack',
  host: 'On this machine, installed directly (not in Docker)',
  remote: 'On another machine',
};

export const ACCESS = {
  home: 'Only on my home network',
  tailscale: 'Tailscale Serve',
  cloudflare: 'Cloudflare Tunnel (my own domain)',
  caddy: 'Caddy (my own domain)',
  npm: 'Nginx Proxy Manager (my own domain)',
};

const NETWORK = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const ADDRESS = /^(\d{1,3}(\.\d{1,3}){3}|[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?)$/i;

// Where Helprr lets the first admin be created when APP_ORIGIN is unset: the same rule as
// src/lib/local-hostname.ts (src/lib/__tests__/configurator-rules.test.ts keeps them equal).
const LOCAL_SUFFIXES = ['.local', '.lan', '.home.arpa', '.internal', '.localhost'];
export function isLocalHostname(hostname) {
  const name = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (name === 'localhost' || name.includes(':')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return true;
  if (!name.includes('.')) return true;
  return LOCAL_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

export const DEFAULTS = { system: 'linux', where: 'host', access: 'home', network: 'arr_default', domain: 'helprr.example.com', serverAddress: '192.168.1.10' };

/** What is wrong with the answers, field by field (empty when nothing is). */
export function problems(answers) {
  const out = {};
  if (!SYSTEMS[answers.system]) out.system = 'Choose a system.';
  if (!WHERE[answers.where]) out.where = 'Choose where your apps run.';
  if (!ACCESS[answers.access]) out.access = 'Choose how you reach Helprr.';
  if (answers.where === 'stack') {
    if (!NETWORK.test(answers.network ?? '')) out.network = 'A Docker network name: letters, digits, _ . - (docker network ls shows them).';
    // Docker's own networks: no names to look up on bridge, and host and none cannot be joined.
    else if (['bridge', 'host', 'none'].includes(answers.network)) out.network = "That is one of Docker's own networks: use your apps' Compose network.";
  }
  if (['cloudflare', 'caddy', 'npm'].includes(answers.access) && !HOSTNAME.test(answers.domain ?? '')) out.domain = 'A name on your domain, such as helprr.example.com.';
  if (!ADDRESS.test(answers.serverAddress ?? '')) out.serverAddress = "This machine's address on your network, such as 192.168.1.10.";
  // Without a domain the first admin is created at this address, which Helprr accepts only
  // when it is a home-network one.
  else if (!['cloudflare', 'caddy', 'npm'].includes(answers.access) && !isLocalHostname(answers.serverAddress)) {
    out.serverAddress = 'Use its IP address or a home-network name (such as nas, nas.lan or nas.local): Helprr creates the first admin only at one of those.';
  }
  return out;
}

/** The Compose file: the release's own, with the apps' network added when Helprr joins it. */
export function composeFor(answers, releaseCompose) {
  if (answers.where !== 'stack') return releaseCompose;
  const service = `    extra_hosts:\n      - "host.docker.internal:host-gateway"\n    networks:\n      - helprr-net\n`;
  const top = `networks:\n  helprr-net:\n    driver: bridge\n`;
  if (releaseCompose.split(service).length !== 2 || releaseCompose.split(top).length !== 2) {
    throw new Error('The Compose file changed shape: update composeFor in configurator.mjs.');
  }
  return releaseCompose
    .replace(service, `${service}      # Your apps' network, so Helprr reaches them by name.\n      - apps\n`)
    // Quoted, so a name such as true or 123 stays a name.
    .replace(top, `${top}  apps:\n    name: ${JSON.stringify(answers.network)}\n    external: true\n`);
}

function appUrl(answers, app) {
  if (answers.where === 'stack') return `http://${app.host}:${app.port}`;
  if (answers.where === 'host') return `http://host.docker.internal:${app.port}`;
  return `http://APP-MACHINE:${app.port}`;
}

/** Everything the page shows, for these answers. */
export function generate(answers, releaseCompose) {
  const bad = problems(answers);
  if (Object.keys(bad).length) return { problems: bad };
  const origin = ['cloudflare', 'caddy', 'npm'].includes(answers.access) ? `https://${answers.domain.toLowerCase()}` : null;
  const compose = composeFor(answers, releaseCompose);
  const changed = compose !== releaseCompose;

  // .env: only what these answers need; everything else has a default.
  const env = [];
  if (origin) env.push(`APP_ORIGIN=${origin}`);
  if (answers.access === 'tailscale' || answers.access === 'caddy') env.push('TRUST_FORWARDED_PROTO=true');
  // Sonarr and Radarr fetch .torrent files from Helprr: give them an address they reach.
  const callback = answers.where === 'stack' ? 'http://helprr:3050'
    : answers.where === 'host' ? 'http://127.0.0.1:3050'
      : `http://${answers.serverAddress}:3050`;
  env.push(`ARR_CALLBACK_ORIGIN=${callback}`);

  // One block that stops at the first failure, in a subshell so a failed step never
  // runs the rest somewhere else; it never replaces an existing .env.
  const commands = ['(', '  set -e'];
  if (answers.where === 'stack') commands.push(`  docker network inspect ${answers.network} >/dev/null  # your apps' network must exist`);
  commands.push('  mkdir -p helprr', '  cd helprr');
  // Running it again keeps the previous Compose file beside the new one.
  commands.push('  if [ -e docker-compose.yml ]; then cp docker-compose.yml docker-compose.yml.bak; fi');
  commands.push(changed
    ? `  cat > docker-compose.yml <<'HELPRR_COMPOSE'\n${compose.replace(/\n$/, '')}\nHELPRR_COMPOSE`
    : `  curl -fsSLO ${RELEASE}/docker-compose.yml`);
  commands.push(`  if [ -e .env ]; then echo '.env exists. Add these lines to it, then run: cd helprr && docker compose up -d'; printf '%s\\n' ${env.map((line) => `'${line}'`).join(' ')}; exit 1; else`);
  commands.push(`  cat > .env <<'EOF'\n${env.join('\n')}\nEOF\n  fi`);
  commands.push('  docker compose up -d', ')');

  // On a public server, the port must answer only this machine (see https.md).
  const vps = `On a machine with a public IP address (a VPS), add HELPRR_PORT=127.0.0.1:3050 to .env and restart Helprr (cd helprr && docker compose up -d --no-build --no-deps helprr), so no one can go around the proxy.${answers.where === 'remote' ? ' Sonarr and Radarr on other machines then add torrents by magnet link only.' : ''}${answers.access === 'npm' ? " Nginx Proxy Manager, in Docker, then cannot reach that port: add the network helprr_helprr-net to its Compose file as an external network (keep its other networks), recreate it, and change the proxy host's Forward Hostname to helprr (see Helprr's Docker network in the HTTPS guide)." : ''}${answers.access === 'cloudflare' ? ' Install cloudflared on the machine itself (not the Docker option), so localhost:3050 still reaches Helprr.' : ''}`;
  const https = {
    home: {
      title: 'No HTTPS',
      steps: [
        `Open Helprr at http://${answers.serverAddress}:3050 at home.`,
        'Push notifications on an iPhone need HTTPS: pick a way below when you want them.',
      ],
      link: `${GUIDES}https/`,
    },
    tailscale: {
      title: 'Tailscale Serve',
      steps: [
        'Sign this machine and your phone in to the same tailnet, with MagicDNS and HTTPS Certificates on.',
        { code: 'sudo tailscale serve --bg http://127.0.0.1:3050' },
        'From now on, open the address `tailscale serve status` shows, on your phone with Tailscale connected.',
      ],
      link: `${GUIDES}https/#tailscale-serve`,
    },
    cloudflare: {
      title: 'Cloudflare Tunnel',
      steps: [
        'In Cloudflare: Networking → Tunnels → Create a tunnel, and run its install command here.',
        `Routes → Add route → Published application: ${answers.domain}, Service URL http://localhost:3050.`,
        'Consider Cloudflare Access in front of it: the address is public.',
        vps,
      ],
      link: `${GUIDES}https/#cloudflare-tunnel`,
    },
    caddy: {
      title: 'Caddy',
      steps: [
        'Point the domain at your public IP address, and forward ports 80 and 443 to this machine.',
        'In the Caddyfile (usually /etc/caddy/Caddyfile):',
        { code: `${answers.domain} {\n  reverse_proxy localhost:3050\n}` },
        { code: 'sudo systemctl reload caddy' },
        vps,
      ],
      link: `${GUIDES}https/#caddy`,
    },
    npm: {
      title: 'Nginx Proxy Manager',
      steps: [
        'Point the domain at your public IP address, and forward ports 80 and 443 to its machine.',
        `Add Proxy Host: ${answers.domain} → http, ${answers.serverAddress}, port 3050.`,
        'SSL tab: request a Let\'s Encrypt certificate, and turn on Force SSL.',
        vps,
      ],
      link: `${GUIDES}https/#nginx-proxy-manager`,
    },
  }[answers.access];

  return {
    problems: {},
    compose,
    composeChanged: changed,
    env,
    commands,
    // Where the first admin is created: the only address Helprr accepts for it. With
    // APP_ORIGIN, exactly that (so HTTPS comes first); without, the home-network address.
    open: origin ?? `http://${answers.serverAddress}:3050`,
    httpsFirst: Boolean(origin),
    apps: APPS.map((app) => ({ name: app.name, url: appUrl(answers, app) })),
    appsNote: {
      stack: "Use each app's container name in your stack if it differs from these.",
      host: 'Each app must listen on all addresses (0.0.0.0), not only 127.0.0.1.',
      remote: "Put that machine's IP address in place of APP-MACHINE.",
    }[answers.where],
    https,
  };
}

/** Every combination, with sample answers: what scripts/check-configurator.mjs checks. */
export function combinations() {
  const all = [];
  for (const system of Object.keys(SYSTEMS)) {
    for (const where of Object.keys(WHERE)) {
      for (const access of Object.keys(ACCESS)) all.push({ ...DEFAULTS, system, where, access });
    }
  }
  return all;
}
