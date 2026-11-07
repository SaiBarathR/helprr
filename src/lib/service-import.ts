import type { ServiceConnection } from '@prisma/client';
import { prisma } from '@/lib/db';
import { SonarrClient } from '@/lib/sonarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { LidarrClient } from '@/lib/lidarr-client';
import type { ProwlarrApplication } from '@/lib/prowlarr-client';
import type { SeerrArrServer } from '@/lib/seerr-client';
import { getProwlarrClient, getSeerrClient } from '@/lib/service-helpers';
import { clearConnectionMemo, ensureDefaultForType } from '@/lib/arr-instances';
import { invalidateReferenceLabels } from '@/lib/cache/reference-labels';
import { connectionFailure, currentHintContext } from '@/lib/connection-hints';
import type { TroubleshootingSection } from '@/lib/docs-links';
import { isRefusedRedirect, REDIRECT_REFUSED_MESSAGE } from '@/lib/redirect-guard';
import { expectServiceVersion, NotServiceApiError } from '@/lib/service-response';
import { withDefaultScheme } from '@/lib/service-url';

/**
 * "We found 3 apps. Add them?": the Sonarr, Radarr and Lidarr servers that Seerr and
 * Prowlarr already know about. Seerr returns each server's API key, so its apps import
 * whole; Prowlarr masks every key, so its apps need the key typed in. Keys stay on the
 * server: a candidate says only whether one is known, and an import looks Seerr's up
 * again by id.
 */
export type ImportType = 'SONARR' | 'RADARR' | 'LIDARR';

export interface ImportCandidate {
  /** "seerr:sonarr:0" or "prowlarr:5". */
  id: string;
  source: 'seerr' | 'prowlarr';
  type: ImportType;
  name: string;
  /** An address Helprr can reach when one was found, else the source's own. */
  url: string;
  reachable: boolean;
  /** Prowlarr masks keys, so its apps need one typed in. */
  needsKey: boolean;
  /** Helprr already has a connection at this address. */
  connected: boolean;
}

export interface ImportDiscovery {
  candidates: ImportCandidate[];
  /** Why a connected source gave nothing ("missing" when Helprr has no such connection). */
  sources: { seerr: 'ok' | 'missing' | 'error'; prowlarr: 'ok' | 'missing' | 'error' };
}

interface Resolved extends ImportCandidate {
  /** Seerr's key for this server; never sent to the browser. */
  sourceKey?: string;
  /** The address the source itself holds, which its key belongs to. */
  sourceUrl: string;
}

const PROWLARR_TYPES: Record<string, ImportType> = { Sonarr: 'SONARR', Radarr: 'RADARR', Lidarr: 'LIDARR' };
const PROBE_TIMEOUT_MS = 2500;

function cleanUrl(url: string): string {
  return withDefaultScheme(url.trim()).replace(/\/+$/, '');
}

/** scheme://host:port/path, so http://Sonarr:8989/ and http://sonarr:8989 are one address. */
export function endpoint(url: string): string | null {
  try {
    const parsed = new URL(url);
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}:${port}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || /^127(\.\d{1,3}){3}$/.test(host) || host === '[::1]' || host === '0.0.0.0';
}

function withHost(url: string, host: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hostname = host;
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** Does a Servarr app answer here? /ping needs no key, and nothing is followed elsewhere. */
async function answersPing(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/ping`, { redirect: 'manual', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Prowlarr's addresses are as Prowlarr sees them, often localhost or a container name.
 * Try the address itself, then the same port on Prowlarr's own host (as Helprr reaches
 * Prowlarr), then host.docker.internal.
 */
async function reachableUrl(url: string, prowlarrUrl: string): Promise<{ url: string; reachable: boolean }> {
  const tries = [url];
  try {
    const prowlarrHost = new URL(prowlarrUrl).hostname;
    if (!isLoopbackHost(prowlarrHost)) tries.push(withHost(url, prowlarrHost) ?? url);
  } catch {
    // Not a URL: only the other tries.
  }
  tries.push(withHost(url, 'host.docker.internal') ?? url);
  for (const candidate of [...new Set(tries)]) {
    if (await answersPing(candidate)) return { url: candidate, reachable: true };
  }
  return { url, reachable: false };
}

export function seerrServerUrl(server: SeerrArrServer): string {
  const path = (server.baseUrl ?? '').replace(/^\/*/, '/').replace(/\/+$/, '');
  return `${server.useSsl ? 'https' : 'http'}://${server.hostname}:${server.port}${path === '/' ? '' : path}`;
}

function prowlarrBaseUrl(application: ProwlarrApplication): string | null {
  const field = application.fields?.find((candidate) => candidate.name === 'baseUrl');
  return typeof field?.value === 'string' && field.value ? cleanUrl(field.value) : null;
}

/**
 * Already connected: Helprr has a connection at exactly this address. A port alone is
 * not enough: two servers on one default port (8989) are often different apps.
 */
function isConnected(type: ImportType, urls: string[], connections: Pick<ServiceConnection, 'type' | 'url'>[]): boolean {
  const mine = new Set(connections.filter((connection) => connection.type === type).map((connection) => endpoint(connection.url)));
  return urls.some((url) => {
    const target = endpoint(url);
    return target !== null && mine.has(target);
  });
}

/**
 * What Seerr and Prowlarr know. With probe, each address is checked for an answer (for the
 * list); without it (for an import, which tests the chosen address itself), no probe runs.
 */
async function resolveCandidates({ probe }: { probe: boolean }): Promise<{ resolved: Resolved[]; sources: ImportDiscovery['sources'] }> {
  const connections = await prisma.serviceConnection.findMany({ select: { type: true, url: true } });
  const has = (type: string) => connections.some((connection) => connection.type === type);
  const sources: ImportDiscovery['sources'] = { seerr: 'missing', prowlarr: 'missing' };
  const resolved: Resolved[] = [];

  if (has('SEERR')) {
    try {
      const seerr = await getSeerrClient();
      for (const kind of ['sonarr', 'radarr'] as const) {
        const servers = await seerr.getArrServers(kind);
        // A wrong address can answer with a page instead of a list.
        if (!Array.isArray(servers)) throw new Error('Seerr did not return its servers');
        await Promise.all(
          servers
            .filter((server) => server && typeof server.hostname === 'string' && server.hostname && Number.isInteger(server.port))
            .map(async (server) => {
              const url = cleanUrl(seerrServerUrl(server));
              const type: ImportType = kind === 'sonarr' ? 'SONARR' : 'RADARR';
              resolved.push({
                id: `seerr:${kind}:${server.id}`,
                source: 'seerr',
                type,
                name: server.name || (kind === 'sonarr' ? 'Sonarr' : 'Radarr'),
                url,
                sourceUrl: url,
                reachable: probe ? await answersPing(url) : false,
                needsKey: !server.apiKey,
                connected: isConnected(type, [url], connections),
                sourceKey: server.apiKey || undefined,
              });
            }),
        );
      }
      sources.seerr = 'ok';
    } catch {
      sources.seerr = 'error';
    }
  }

  if (has('PROWLARR')) {
    try {
      const prowlarr = await getProwlarrClient();
      const applications = await prowlarr.getApplications();
      const prowlarrUrl = connections.find((connection) => connection.type === 'PROWLARR')?.url ?? '';
      await Promise.all(
        applications.map(async (application) => {
          const type = PROWLARR_TYPES[application.implementation];
          const base = prowlarrBaseUrl(application);
          if (!type || !base) return;
          const { url, reachable } = probe ? await reachableUrl(base, prowlarrUrl) : { url: base, reachable: false };
          resolved.push({
            id: `prowlarr:${application.id}`,
            source: 'prowlarr',
            type,
            name: application.name || application.implementation,
            url,
            sourceUrl: base,
            reachable,
            needsKey: true,
            connected: isConnected(type, [base, url], connections),
          });
        }),
      );
      sources.prowlarr = 'ok';
    } catch {
      sources.prowlarr = 'error';
    }
  }

  // Seerr and Prowlarr often know the same app: list it once, keeping the one whose key
  // is known (Seerr's) and otherwise the first found.
  const unique: Resolved[] = [];
  const order = (candidate: Resolved) => Number(Boolean(candidate.sourceKey)) * 2 + Number(candidate.source === 'seerr');
  for (const candidate of [...resolved].sort((a, b) => order(b) - order(a) || a.id.localeCompare(b.id))) {
    const at = endpoint(candidate.url);
    if (!unique.some((kept) => kept.type === candidate.type && endpoint(kept.url) === at)) unique.push(candidate);
  }
  unique.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  return { resolved: unique, sources };
}

export async function discoverImportCandidates(): Promise<ImportDiscovery> {
  const { resolved, sources } = await resolveCandidates({ probe: true });
  // Only what the browser may see: no key, no source address.
  const candidates = resolved.map(({ id, source, type, name, url, reachable, needsKey, connected }) => ({
    id, source, type, name, url, reachable, needsKey, connected,
  }));
  return { candidates, sources };
}

export interface ImportItem {
  id: string;
  label?: string;
  url?: string;
  apiKey?: string;
}

export interface ImportResult {
  id: string;
  ok: boolean;
  label?: string;
  error?: string;
  /** The guides section that explains a failed test. */
  help?: TroubleshootingSection;
}

function clientFor(type: ImportType, url: string, apiKey: string) {
  if (type === 'SONARR') return new SonarrClient(url, apiKey);
  if (type === 'RADARR') return new RadarrClient(url, apiKey);
  return new LidarrClient(url, apiKey);
}

async function testFailure(error: unknown, url: string): Promise<{ error: string; help?: TroubleshootingSection }> {
  if (error instanceof NotServiceApiError) return { error: 'That address answers, but not as this app. Check the address.', help: 'it-answered-but-not-as-that-app' };
  if (isRefusedRedirect(error)) return { error: REDIRECT_REFUSED_MESSAGE, help: 'the-address-redirects' };
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 401) return { error: 'The app turned down the API key.', help: 'the-key-was-refused' };
  const found = connectionFailure(error, url, await currentHintContext(url));
  return found ? { error: found.message, help: found.section } : { error: `Helprr could not reach ${url}.` };
}

/** Tests each chosen app from Helprr, then saves it as a new instance. One at a time, so names never collide. */
export async function importServices(
  items: ImportItem[],
  /** Called once per saved connection, e.g. to audit it. */
  onCreated?: (connection: { id: string; type: ImportType; label: string }) => Promise<void>,
): Promise<ImportResult[]> {
  const { resolved } = await resolveCandidates({ probe: false });
  const results: ImportResult[] = [];
  for (const item of items) {
    const candidate = resolved.find((entry) => entry.id === item.id);
    if (!candidate) {
      results.push({ id: item.id, ok: false, error: 'This app is no longer listed. Refresh and try again.' });
      continue;
    }
    const url = item.url?.trim() ? cleanUrl(item.url) : candidate.url;
    // A stale page must not add an app twice.
    const existing = await prisma.serviceConnection.findMany({ where: { type: candidate.type }, select: { type: true, url: true } });
    if (isConnected(candidate.type, [url], existing)) {
      results.push({ id: item.id, ok: false, error: 'Helprr already has this app at that address.' });
      continue;
    }
    const typedKey = item.apiKey?.trim() || undefined;
    // Seerr's key belongs to the address Seerr holds: it is never sent anywhere else.
    const sourceKeyAllowed = candidate.sourceKey && endpoint(url) === endpoint(candidate.sourceUrl);
    const apiKey = typedKey ?? (sourceKeyAllowed ? candidate.sourceKey : undefined);
    if (!apiKey) {
      results.push({
        id: item.id,
        ok: false,
        error: candidate.sourceKey ? 'Enter the API key to use another address.' : 'Enter the API key.',
      });
      continue;
    }
    const label = item.label?.trim() || candidate.name;
    if (await prisma.serviceConnection.findFirst({ where: { type: candidate.type, label }, select: { id: true } })) {
      results.push({ id: item.id, ok: false, label, error: `An instance named "${label}" already exists for this service.` });
      continue;
    }
    try {
      const status = await clientFor(candidate.type, url, apiKey).getSystemStatus();
      expectServiceVersion(status?.version);
    } catch (error) {
      results.push({ id: item.id, ok: false, label, ...(await testFailure(error, url)) });
      continue;
    }
    try {
      const connection = await prisma.serviceConnection.create({ data: { type: candidate.type, label, url, apiKey } });
      await ensureDefaultForType(candidate.type);
      clearConnectionMemo();
      await invalidateReferenceLabels(candidate.type.toLowerCase(), connection.id);
      await onCreated?.({ id: connection.id, type: candidate.type, label });
      results.push({ id: item.id, ok: true, label });
    } catch (error) {
      const duplicate = (error as { code?: string }).code === 'P2002';
      results.push({
        id: item.id,
        ok: false,
        label,
        error: duplicate ? `An instance named "${label}" already exists for this service.` : 'Could not save this connection.',
      });
    }
  }
  return results;
}
