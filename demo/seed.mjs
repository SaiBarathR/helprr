// Connects the demo Helprr to the fake apps (demo/fake-upstreams.mjs), through Helprr's own
// API, as the demo admin. Run once by docker-compose.demo.yml after Helprr starts; a
// connection that already exists is left alone, so running it again changes nothing.
const BASE = process.env.DEMO_HELPRR_URL ?? 'http://helprr-demo:3050';
const UPSTREAMS = process.env.DEMO_UPSTREAMS_URL ?? 'http://helprr-demo-upstreams';
const USERNAME = 'demo';
const PASSWORD = 'helprr-demo-password'; // src/lib/demo.ts
// The fake apps take any key; this one only has to look like one.
const KEY = 'demo0000000000000000000000000000';

const CONNECTIONS = [
  { type: 'SONARR', port: 8989, label: 'Sonarr' },
  { type: 'RADARR', port: 7878, label: 'Radarr' },
  { type: 'LIDARR', port: 8686, label: 'Lidarr' },
  { type: 'QBITTORRENT', port: 8080, username: 'demo' },
  { type: 'PROWLARR', port: 9696 },
  { type: 'JELLYFIN', port: 8096 },
  { type: 'SEERR', port: 5055 },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// An answer that waiting cannot change (a refused sign-in, a bad request) fails at once;
// a network error or a 5xx is tried again.
class Final extends Error {}

async function retry(what, attempt, tries = 90) {
  for (let i = 1; ; i++) {
    try {
      return await attempt();
    } catch (error) {
      if (error instanceof Final || i >= tries) throw new Error(`${what}: ${error.message}`);
      await sleep(2000);
    }
  }
}

async function check(res, what) {
  if (res.ok) return res;
  const message = `${what} answered ${res.status}: ${(await res.text()).slice(0, 200)}`;
  throw res.status >= 500 ? new Error(message) : new Final(message);
}

await retry('Helprr did not become ready', async () => {
  const res = await fetch(`${BASE}/api/ready`);
  // Not ready yet is the answer to wait on, whatever its status.
  if (!res.ok) throw new Error(`ready answered ${res.status}`);
});

const cookie = await retry('could not sign in as the demo admin', async () => {
  const res = await check(await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  }), 'sign-in');
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}, 10);
const headers = { cookie, 'content-type': 'application/json' };

const existing = await retry('could not list the connections', async () => (await check(await fetch(`${BASE}/api/services`, { headers }), 'connections')).json(), 10);
const have = new Set(existing.map((s) => s.type));

for (const { type, port, ...extra } of CONNECTIONS) {
  if (have.has(type)) {
    console.log(`demo seed: ${type} already connected`);
    continue;
  }
  await retry(`could not connect ${type}`, async () => {
    await check(await fetch(`${BASE}/api/services`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type, url: `${UPSTREAMS}:${port}`, apiKey: KEY, ...extra }),
    }), type);
  }, 15);
  console.log(`demo seed: ${type} connected`);
}
console.log(`demo seed: done. Open Helprr and sign in as ${USERNAME}.`);
