import { readFile } from 'node:fs/promises';
import { Resolver } from 'node:dns/promises';
import { prisma } from '@/lib/db';

/**
 * "Find apps on this network": looks for the usual apps where a Compose stack or the same
 * computer puts them, so people need not know container names or ports.
 *
 * Safety: the targets are a fixed list, never user input: each app's container names,
 * host.docker.internal and the container's default gateway, each on that app's usual
 * port. Requests carry no credentials, follow no redirects, time out quickly, read little,
 * and run a few at a time; one scan at a time, at most every 30 seconds. Each app is told
 * apart without credentials. /initialize.json is never read: Servarr apps return their API
 * key there to local requests, and no key may come from a scan.
 */
import { isPrivateIpv4, scanTargets, type ScanTarget, type ScanType } from '@/lib/app-scan-targets';

export { scanTargets, type ScanTarget, type ScanType };

export interface FoundApp extends ScanTarget {
  /** Helprr already has a connection at exactly this address. */
  connected: boolean;
  /** Helprr has this kind of app at another address: this may be the same one. */
  hasOther: boolean;
}

const REQUEST_TIMEOUT_MS = 1500;
const LOOKUP_TIMEOUT_MS = 1000;
const MAX_BODY_BYTES = 64 * 1024;
const CONCURRENCY = 4;
const MIN_INTERVAL_MS = 30_000;

/** An address only a home network or this machine uses. */
export function isLocalAddress(address: string): boolean {
  if (isPrivateIpv4(address)) return true;
  if (/^127\./.test(address) || /^169\.254\./.test(address) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)) return true;
  const v6 = address.toLowerCase();
  return v6 === '::1' || /^f[cd][0-9a-f]{2}:/.test(v6) || /^fe[89ab][0-9a-f]:/.test(v6);
}

/** The addresses /etc/hosts gives a name (Docker writes host.docker.internal there). */
export function hostsFileAddresses(hostsFile: string, host: string): string[] {
  const name = host.toLowerCase();
  return hostsFile.split('\n').flatMap((line) => {
    const [address, ...names] = line.replace(/#.*/, '').trim().split(/\s+/);
    return address && names.some((entry) => entry.toLowerCase() === name) ? [address] : [];
  });
}

/**
 * A name is looked up first, and skipped unless every address is local: a missing
 * container name can otherwise be passed on to the host's resolvers and land on the
 * internet. Not with the system lookup: it runs on Node's four-thread pool and cannot be
 * stopped, so a missing name left waiting there past the timeout held up every later
 * lookup, host.docker.internal's included, and every fetch. /etc/hosts is read
 * directly, and DNS asked with its own timeout.
 *
 * Returns the address the requests then go to: the one checked, never a second lookup
 * that a search domain or a changing DNS answer could send elsewhere.
 */
async function localAddress(url: string): Promise<string | null> {
  const host = new URL(url).hostname;
  if (isPrivateIpv4(host)) return host;
  let addresses = hostsFileAddresses(await readFile('/etc/hosts', 'utf8').catch(() => ''), host);
  if (addresses.length === 0) {
    const resolver = new Resolver({ timeout: LOOKUP_TIMEOUT_MS, tries: 1 });
    const [v4, v6] = await Promise.all([resolver.resolve4(host).catch(() => []), resolver.resolve6(host).catch(() => [])]);
    addresses = [...v4, ...v6];
  }
  return addresses.length > 0 && addresses.every(isLocalAddress) ? addresses[0] : null;
}

/** The URL with its name replaced by the address checked for it. */
function atAddress(url: string, address: string): string {
  const parsed = new URL(url);
  parsed.hostname = address.includes(':') ? `[${address}]` : address;
  return parsed.toString().replace(/\/$/, '');
}

/** The container's default gateway (the Docker host, from inside a container), from /proc/net/route. */
export function parseDefaultGateway(routeTable: string): string | null {
  for (const line of routeTable.split('\n').slice(1)) {
    const [, destination, gateway] = line.trim().split(/\s+/);
    if (destination !== '00000000' || !gateway || !/^[0-9A-F]{8}$/i.test(gateway)) continue;
    // Little-endian hex: 0100A8C0 is 192.168.0.1.
    const bytes = gateway.match(/../g)!.map((pair) => parseInt(pair, 16)).reverse();
    const address = bytes.join('.');
    return isPrivateIpv4(address) ? address : null;
  }
  return null;
}

async function defaultGateway(): Promise<string | null> {
  try {
    return parseDefaultGateway(await readFile('/proc/net/route', 'utf8'));
  } catch {
    return null;
  }
}

interface Reply {
  status: number;
  location: string | null;
  body: string;
}

/** One request: no credentials, no redirects, a short timeout, and at most 64 KB read. */
async function get(url: string): Promise<Reply | null> {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), credentials: 'omit' });
    let body = '';
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let read = 0;
      while (read < MAX_BODY_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        read += value.byteLength;
        body += decoder.decode(value, { stream: true });
      }
      await reader.cancel().catch(() => {});
    }
    return { status: response.status, location: response.headers.get('location'), body };
  } catch {
    return null;
  }
}

function json(reply: Reply | null): Record<string, unknown> | null {
  if (!reply || reply.status !== 200) return null;
  try {
    const parsed = JSON.parse(reply.body);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const SERVARR_NAMES: Partial<Record<ScanType, string>> = { SONARR: 'Sonarr', RADARR: 'Radarr', LIDARR: 'Lidarr', PROWLARR: 'Prowlarr' };

/** Is this app answering at this address? Told apart without any credentials. */
export async function fingerprint(type: ScanType, base: string): Promise<boolean> {
  const name = SERVARR_NAMES[type];
  if (name) {
    // /ping is the same for every Servarr app, so the page title names it.
    if (json(await get(`${base}/ping`))?.status !== 'OK') return false;
    let page = await get(`${base}/`);
    // Behind a login form, / sends to the login page; that fixed path is read instead.
    if (page && page.status >= 300 && page.status < 400 && /^\/?login/i.test((page.location ?? '').replace(/^https?:\/\/[^/]+/i, ''))) {
      page = await get(`${base}/login`);
    }
    return Boolean(page && page.status === 200 && new RegExp(`<title>\\s*(?:Login - )?${name}\\s*</title>`, 'i').test(page.body));
  }
  if (type === 'JELLYFIN') return json(await get(`${base}/System/Info/Public`))?.ProductName === 'Jellyfin Server';
  if (type === 'SEERR') {
    const status = json(await get(`${base}/api/v1/status`));
    return typeof status?.version === 'string' && 'commitTag' in status;
  }
  // qBittorrent: its API turns away a request without a session, and / is its web UI.
  const api = await get(`${base}/api/v2/app/webapiVersion`);
  if (!api || (api.status !== 403 && !(api.status === 200 && /^\d+\.\d+/.test(api.body.trim())))) return false;
  const page = await get(`${base}/`);
  return Boolean(page && page.status === 200 && /<title>[^<]*(qbittorrent|vuetorrent)[^<]*<\/title>/i.test(page.body));
}

function endpoint(url: string): string | null {
  try {
    const parsed = new URL(url);
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}:${port}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

async function runScan(): Promise<ScanTarget[]> {
  const targets = scanTargets(await defaultGateway());
  const hits: ScanTarget[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < targets.length) {
        const target = targets[next++];
        const address = await localAddress(target.url);
        if (address && (await fingerprint(target.type, atAddress(target.url, address)))) hits.push(target);
      }
    }),
  );
  // Every hit, in the fixed order; scanForApps keeps one per app.
  const order = (target: ScanTarget) => targets.findIndex((candidate) => candidate.url === target.url);
  return hits.sort((a, b) => order(a) - order(b));
}

// One scan at a time, and a fresh one at most every 30 seconds (shared by Next.js's module copies).
const state = globalThis as unknown as { __helprrAppScan?: { at: number; running: boolean; result: Promise<ScanTarget[]> } };

function scanOnce(now: number): Promise<ScanTarget[]> {
  const last = state.__helprrAppScan;
  // A scan still running is always shared; a finished one for 30 seconds from its start.
  if (last && (last.running || now - last.at < MIN_INTERVAL_MS)) return last.result;
  const entry = { at: now, running: true, result: runScan() };
  state.__helprrAppScan = entry;
  entry.result.then(
    () => {
      entry.running = false;
    },
    () => {
      if (state.__helprrAppScan === entry) delete state.__helprrAppScan;
    },
  );
  return entry.result;
}

/**
 * What answers on the fixed list, one address per app: the one Helprr already has when it
 * is among them, else the first in the fixed order. Worked out fresh against the
 * connections each time.
 */
export async function scanForApps(now = Date.now()): Promise<FoundApp[]> {
  const hits = await scanOnce(now);
  const connections = await prisma.serviceConnection.findMany({ select: { type: true, url: true } });
  const isConnected = (hit: ScanTarget) =>
    connections.some((connection) => connection.type === hit.type && endpoint(connection.url) === endpoint(hit.url));
  const found: FoundApp[] = [];
  for (const hit of hits) {
    if (found.some((kept) => kept.type === hit.type)) continue;
    const pick = hits.find((other) => other.type === hit.type && isConnected(other)) ?? hit;
    const connected = isConnected(pick);
    found.push({ ...pick, connected, hasOther: !connected && connections.some((connection) => connection.type === hit.type) });
  }
  return found;
}
