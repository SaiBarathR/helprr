import type { ServiceConnection, User } from '@prisma/client';
import type { Tagged } from '@/lib/discover';
import type { QBittorrentTorrent, RadarrMovie, SonarrSeries } from '@/types';
import { prisma } from '@/lib/db';
import { readJellyfinToken } from '@/lib/jellyfin-token';
import { ConfigurationError } from '@/lib/config-error';
import { sha256Hex, stableStringify } from '@/lib/cache/keys';
import { SonarrClient } from '@/lib/sonarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { LidarrClient } from '@/lib/lidarr-client';
import { QBittorrentClient } from '@/lib/qbittorrent-client';
import { forgetQBittorrentSyncsExcept } from '@/lib/qbittorrent-sync';
import { ProwlarrClient } from '@/lib/prowlarr-client';
import { JellyfinClient } from '@/lib/jellyfin-client';
import { TmdbClient } from '@/lib/tmdb-client';
import { SeerrClient } from '@/lib/seerr-client';
import { resolveConnection, listConnections } from '@/lib/arr-instances';
import { getConnectionHeaders } from '@/lib/service-connection-secrets';

// Kept on globalThis, like the connection memo (arr-instances.ts): each API
// route and the poller get their own copy of this module, and a map per copy
// meant a qBittorrent session, and a sign-in, per route.
const qbitClientsGlobal = globalThis as typeof globalThis & {
  __helprrQBittorrentClients?: Map<string, { configKey: string; client: QBittorrentClient }>;
};
const cachedQBittorrentClients = qbitClientsGlobal.__helprrQBittorrentClients ??= new Map();

export function buildJellyfinConnectionFingerprint(connection: ServiceConnection): string {
  return sha256Hex(stableStringify({
    apiKey: connection.apiKey,
    url: connection.url,
    username: connection.username ?? null,
    customHeaders: getConnectionHeaders(connection) ?? null,
  }));
}

export async function getSonarrClient(instanceId?: string): Promise<SonarrClient> {
  const connection = await resolveConnection('SONARR', instanceId);
  return new SonarrClient(connection.url, connection.apiKey, getConnectionHeaders(connection));
}

export async function getRadarrClient(instanceId?: string): Promise<RadarrClient> {
  const connection = await resolveConnection('RADARR', instanceId);
  return new RadarrClient(connection.url, connection.apiKey, getConnectionHeaders(connection));
}

export async function getLidarrClient(instanceId?: string): Promise<LidarrClient> {
  const connection = await resolveConnection('LIDARR', instanceId);
  return new LidarrClient(connection.url, connection.apiKey, getConnectionHeaders(connection));
}

/** All Sonarr instances paired with a ready client (for fan-out: polling, aggregation, cleanup). */
export async function getSonarrClients(): Promise<Array<{ connection: ServiceConnection; client: SonarrClient }>> {
  const conns = await listConnections('SONARR');
  return conns.map((connection) => ({ connection, client: new SonarrClient(connection.url, connection.apiKey, getConnectionHeaders(connection)) }));
}

export async function getRadarrClients(): Promise<Array<{ connection: ServiceConnection; client: RadarrClient }>> {
  const conns = await listConnections('RADARR');
  return conns.map((connection) => ({ connection, client: new RadarrClient(connection.url, connection.apiKey, getConnectionHeaders(connection)) }));
}

export async function getLidarrClients(): Promise<Array<{ connection: ServiceConnection; client: LidarrClient }>> {
  const conns = await listConnections('LIDARR');
  return conns.map((connection) => ({ connection, client: new LidarrClient(connection.url, connection.apiKey, getConnectionHeaders(connection)) }));
}

/**
 * The one client for this qBittorrent and its settings: it holds the session
 * cookie, so every caller (routes, pollers, the reachability probe) shares one
 * sign-in per instance. A new client signs in again; per poll cycle that filled
 * qBittorrent's log with "WebAPI login success" every few seconds.
 */
export function qbittorrentClientFor(connection: ServiceConnection): QBittorrentClient {
  const username = connection.username || 'admin';
  const customHeaders = getConnectionHeaders(connection);
  const configKey = `${connection.url}|${connection.apiKey}|${username}|${customHeaders ? stableStringify(customHeaders) : ''}`;
  const cached = cachedQBittorrentClients.get(connection.id);
  if (cached && cached.configKey === configKey) return cached.client;
  // One client per instance and setting: it holds that qBittorrent's session cookie.
  const client = new QBittorrentClient(connection.url, connection.apiKey, username, customHeaders, connection.id);
  cachedQBittorrentClients.set(connection.id, { configKey, client });
  return client;
}

/**
 * A client for the qBittorrent `instanceId` names, or the default one when it
 * names none. Like the arrs: an id that is not a qBittorrent connection throws
 * rather than falling back to the default (routes check it first, see
 * src/lib/server/qbittorrent-instance.ts).
 *
 * @throws ConfigurationError when no qBittorrent is configured.
 */
export async function getQBittorrentClient(instanceId?: string): Promise<QBittorrentClient> {
  const connection = await resolveConnection('QBITTORRENT', instanceId).catch((error: unknown) => {
    // The wording the settings UI and older callers know.
    if (!instanceId && error instanceof ConfigurationError) {
      throw new ConfigurationError('qBittorrent is not configured. Please add a qBittorrent connection in Settings.');
    }
    throw error;
  });
  return qbittorrentClientFor(connection);
}

/** Every qBittorrent, default first, with a ready client (for fan-out: polling, cleanup, totals). */
export async function getQBittorrentClients(): Promise<Array<{ connection: ServiceConnection; client: QBittorrentClient }>> {
  const connections = await listConnections('QBITTORRENT');
  // A removed instance's client (its session) and merged list are let go.
  const live = new Set(connections.map((connection) => connection.id));
  for (const id of cachedQBittorrentClients.keys()) if (!live.has(id)) cachedQBittorrentClients.delete(id);
  forgetQBittorrentSyncsExcept(live);
  return connections.map((connection) => ({ connection, client: qbittorrentClientFor(connection) }));
}

/**
 * The qBittorrents that list `hash`, default first, for work that knows a
 * torrent but not which qBittorrent holds it (a release an arr sent to its own
 * download client, a manual download). `failed` counts the instances that did
 * not answer, so a caller about to change the torrent can tell "only here"
 * from "not known elsewhere".
 */
export async function findQBittorrentsWithTorrent(hash: string): Promise<{
  found: Array<{ connection: ServiceConnection; client: QBittorrentClient; torrent: QBittorrentTorrent }>;
  failed: number;
}> {
  const instances = await getQBittorrentClients();
  if (instances.length === 0) {
    throw new ConfigurationError('qBittorrent is not configured. Please add a qBittorrent connection in Settings.');
  }
  let failed = 0;
  const found = (await Promise.all(instances.map(async ({ connection, client }) => {
    try {
      const [torrent] = await client.getTorrents(undefined, undefined, undefined, undefined, hash.toLowerCase());
      return torrent ? [{ connection, client, torrent }] : [];
    } catch {
      failed += 1;
      return [];
    }
  }))).flat();
  return { found, failed };
}

/**
 * Creates a Prowlarr client from the PROWLARR service connection. Prowlarr is
 * single-instance, so findFirst returns the one configured connection.
 *
 * @returns A configured ProwlarrClient instance
 * @throws Error if no PROWLARR connection is found in the database
 */
export async function getProwlarrClient(): Promise<ProwlarrClient> {
  const connection = await prisma.serviceConnection.findFirst({
    where: { type: 'PROWLARR' },
  });

  if (!connection) {
    throw new ConfigurationError(
      'Prowlarr is not configured. Please add a Prowlarr connection in Settings.'
    );
  }

  return new ProwlarrClient(connection.url, connection.apiKey, getConnectionHeaders(connection));
}

export async function getJellyfinClient(): Promise<JellyfinClient> {
  const { client } = await getJellyfinClientContext();
  return client;
}

export async function getJellyfinClientContext(): Promise<{
  client: JellyfinClient;
  connection: ServiceConnection;
  connectionFingerprint: string;
}> {
  const connection = await prisma.serviceConnection.findFirst({
    where: { type: 'JELLYFIN' },
  });

  if (!connection) {
    throw new ConfigurationError(
      'Jellyfin is not configured. Please add a Jellyfin connection in Settings.'
    );
  }

  if (!connection.username) {
    throw new ConfigurationError(
      'Jellyfin user context is missing. Re-test and save the Jellyfin connection in Settings.'
    );
  }

  return {
    client: new JellyfinClient(connection.url, connection.apiKey, connection.username, getConnectionHeaders(connection)),
    connection,
    connectionFingerprint: buildJellyfinConnectionFingerprint(connection),
  };
}

/** Thrown when a member has no linked Jellyfin account, so their user-scoped reads
 * can't resolve. Routes catch it and return `{ linked: false }` instead of 500ing. */
export class JellyfinNotLinkedError extends Error {
  constructor(message = 'Jellyfin account not linked') {
    super(message);
    this.name = 'JellyfinNotLinkedError';
  }
}

/**
 * A benign "Jellyfin can't serve this user right now" condition — not configured,
 * not linked, or no resolvable user — that routes turn into an empty response
 * instead of a 500. Single source so the matched strings can't drift per route.
 */
export function isJellyfinUnavailable(error: unknown): boolean {
  if (error instanceof JellyfinNotLinkedError) return true;
  const message = (error as { message?: string })?.message ?? '';
  return message.includes('not configured') || message.includes('context is missing');
}

/**
 * Jellyfin client scoped to a specific Helprr user. Uses the admin API key (which
 * can read any user's user-scoped endpoints) but the *member's* jellyfinUserId, so
 * a member sees their own resume/history — never the admin's. Admins fall back to
 * the connection's configured user when they have no personal link (preserves
 * pre-multi-user behavior).
 */
export async function getJellyfinClientForUser(
  user: Pick<User, 'role' | 'jellyfinUserId'>
): Promise<JellyfinClient> {
  return (await getJellyfinUserContext(user)).client;
}

/**
 * Like {@link getJellyfinClientForUser} but also returns the resolved Jellyfin
 * user id and the connection fingerprint — what per-user caches (watch status)
 * key on, so a read and its post-write invalidation hit the exact same key.
 */
export async function getJellyfinUserContext(
  user: Pick<User, 'role' | 'jellyfinUserId'>
): Promise<{ client: JellyfinClient; connectionFingerprint: string; jellyfinUserId: string }> {
  const connection = await prisma.serviceConnection.findFirst({ where: { type: 'JELLYFIN' } });
  if (!connection) {
    throw new ConfigurationError('Jellyfin is not configured. Please add a Jellyfin connection in Settings.');
  }

  const userId =
    user.role === 'admin' ? user.jellyfinUserId ?? connection.username ?? null : user.jellyfinUserId;
  if (!userId) {
    throw new JellyfinNotLinkedError();
  }

  return {
    client: new JellyfinClient(connection.url, connection.apiKey, userId, getConnectionHeaders(connection)),
    connectionFingerprint: buildJellyfinConnectionFingerprint(connection),
    jellyfinUserId: userId,
  };
}

/**
 * Thrown when a member has no usable Jellyfin access token of their own, so
 * playback cannot be attributed to them. Distinct from JellyfinNotLinkedError:
 * that is missing *identity*, this is a missing *credential*. Both send the
 * member to the same connect gate, since connecting also auto-links.
 */
export class JellyfinNotConnectedError extends Error {
  constructor(message = 'Jellyfin account not connected') {
    super(message);
    this.name = 'JellyfinNotConnectedError';
  }
}

/**
 * Jellyfin client for *playing* as a member, as opposed to reading their data.
 *
 * Reads keep the admin API key (scoped by an explicit userId param), but every
 * playback call is signed with the member's own token, because Jellyfin decides
 * whose session it is from the token alone. Throws rather than falling back to
 * the API key: an unattributed session is the bug, not an acceptable degraded
 * mode. Callers map the throw to the connect gate.
 */
export async function getJellyfinPlaybackContext(
  user: Pick<User, 'id' | 'role' | 'jellyfinUserId' | 'jellyfinToken'>
): Promise<{ client: JellyfinClient; jellyfinUserId: string; connectionFingerprint: string }> {
  const playbackToken = readJellyfinToken(user);
  if (!playbackToken) throw new JellyfinNotConnectedError();

  const connection = await prisma.serviceConnection.findFirst({ where: { type: 'JELLYFIN' } });
  if (!connection) {
    throw new ConfigurationError('Jellyfin is not configured. Please add a Jellyfin connection in Settings.');
  }

  const userId =
    user.role === 'admin' ? user.jellyfinUserId ?? connection.username ?? null : user.jellyfinUserId;
  if (!userId) {
    throw new JellyfinNotLinkedError();
  }

  return {
    client: new JellyfinClient(
      connection.url,
      connection.apiKey,
      userId,
      getConnectionHeaders(connection),
      playbackToken,
    ),
    jellyfinUserId: userId,
    connectionFingerprint: buildJellyfinConnectionFingerprint(connection),
  };
}

export async function getSeerrClient(): Promise<SeerrClient> {
  const connection = await prisma.serviceConnection.findFirst({
    where: { type: 'SEERR' },
  });

  if (!connection) {
    throw new ConfigurationError('Seerr is not configured. Please add a Seerr connection in Settings.');
  }

  return new SeerrClient(connection.url, connection.apiKey, getConnectionHeaders(connection));
}

export async function getTMDBClient(): Promise<TmdbClient> {
  const connection = await prisma.serviceConnection.findFirst({
    where: { type: 'TMDB' },
  });

  if (!connection) {
    throw new ConfigurationError('TMDB is not configured. Please add a TMDB connection in Settings.');
  }

  return new TmdbClient(connection.url, connection.apiKey);
}

/**
 * Load the full library across every Radarr + Sonarr instance, tagging each item
 * with its instance. Per-instance failures are swallowed (one unreachable instance
 * must not blank the whole library) and listed in `failedInstanceIds`, so a caller
 * can tell "not in that instance" from "that instance did not answer". The single
 * fan-out used by all library-matching consumers (discover, anime, watchlist,
 * recommendations, random, library-gaps).
 */
export async function loadTaggedLibrary(): Promise<{
  movies: Tagged<RadarrMovie>[];
  series: Tagged<SonarrSeries>[];
  failedInstanceIds: string[];
}> {
  const failedInstanceIds: string[] = [];
  const movies = (
    await Promise.all(
      (await getRadarrClients()).map(async ({ connection, client }) => {
        try {
          return (await client.getMovies()).map((m) => ({ ...m, instanceId: connection.id, instanceLabel: connection.label }));
        } catch {
          failedInstanceIds.push(connection.id);
          return [] as Tagged<RadarrMovie>[];
        }
      })
    )
  ).flat();
  const series = (
    await Promise.all(
      (await getSonarrClients()).map(async ({ connection, client }) => {
        try {
          return (await client.getSeries()).map((s) => ({ ...s, instanceId: connection.id, instanceLabel: connection.label }));
        } catch {
          failedInstanceIds.push(connection.id);
          return [] as Tagged<SonarrSeries>[];
        }
      })
    )
  ).flat();
  return { movies, series, failedInstanceIds };
}
