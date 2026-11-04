import { readFile } from 'node:fs/promises';
import type { ServiceType } from '@prisma/client';
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
export type ScanType = Extract<ServiceType, 'SONARR' | 'RADARR' | 'LIDARR' | 'PROWLARR' | 'QBITTORRENT' | 'JELLYFIN' | 'SEERR'>;

interface ScanApp {
  type: ScanType;
  port: number;
  names: string[];
}

const APPS: ScanApp[] = [
  { type: 'SONARR', port: 8989, names: ['sonarr'] },
  { type: 'RADARR', port: 7878, names: ['radarr'] },
  { type: 'LIDARR', port: 8686, names: ['lidarr'] },
  { type: 'PROWLARR', port: 9696, names: ['prowlarr'] },
  { type: 'QBITTORRENT', port: 8080, names: ['qbittorrent'] },
  { type: 'JELLYFIN', port: 8096, names: ['jellyfin'] },
  { type: 'SEERR', port: 5055, names: ['seerr', 'jellyseerr', 'overseerr'] },
];

export interface ScanTarget {
  type: ScanType;
  url: string;
}

export interface FoundApp extends ScanTarget {
  /** Helprr already has a connection at exactly this address. */
  connected: boolean;
}

const REQUEST_TIMEOUT_MS = 1500;
const MAX_BODY_BYTES = 64 * 1024;
const CONCURRENCY = 4;
const MIN_INTERVAL_MS = 30_000;

function isPrivateIpv4(host: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Every address a scan may contact: the fixed list, plus a private gateway address. */
export function scanTargets(gateway: string | null): ScanTarget[] {
  const extraHosts = ['host.docker.internal', ...(gateway && isPrivateIpv4(gateway) ? [gateway] : [])];
  return APPS.flatMap((app) => [...app.names, ...extraHosts].map((host) => ({ type: app.type, url: `http://${host}:${app.port}` })));
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
        if (await fingerprint(target.type, target.url)) hits.push(target);
      }
    }),
  );
  // One address per app: the same app often answers at its container name and the host.
  const order = (target: ScanTarget) => targets.findIndex((candidate) => candidate.url === target.url);
  const found: ScanTarget[] = [];
  for (const hit of hits.sort((a, b) => order(a) - order(b))) {
    if (!found.some((kept) => kept.type === hit.type)) found.push(hit);
  }
  return found;
}

// One scan at a time, and a fresh one at most every 30 seconds (shared by Next.js's module copies).
const state = globalThis as unknown as { __helprrAppScan?: { at: number; result: Promise<ScanTarget[]> } };

function scanOnce(now: number): Promise<ScanTarget[]> {
  const last = state.__helprrAppScan;
  if (last && now - last.at < MIN_INTERVAL_MS) return last.result;
  const result = runScan();
  state.__helprrAppScan = { at: now, result };
  result.catch(() => {
    if (state.__helprrAppScan?.result === result) delete state.__helprrAppScan;
  });
  return result;
}

/** What answers on the fixed list; "connected" is worked out fresh each time. */
export async function scanForApps(now = Date.now()): Promise<FoundApp[]> {
  const found = await scanOnce(now);
  const connections = await prisma.serviceConnection.findMany({ select: { type: true, url: true } });
  return found.map((app) => ({
    ...app,
    connected: connections.some((connection) => connection.type === app.type && endpoint(connection.url) === endpoint(app.url)),
  }));
}
