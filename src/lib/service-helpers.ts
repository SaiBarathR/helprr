import type { ServiceConnection, User } from '@prisma/client';
import type { Tagged } from '@/lib/discover';
import type { RadarrMovie, SonarrSeries } from '@/types';
import { prisma } from '@/lib/db';
import { ConfigurationError } from '@/lib/config-error';
import { sha256Hex, stableStringify } from '@/lib/cache/keys';
import { SonarrClient } from '@/lib/sonarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { LidarrClient } from '@/lib/lidarr-client';
import { QBittorrentClient } from '@/lib/qbittorrent-client';
import { ProwlarrClient } from '@/lib/prowlarr-client';
import { JellyfinClient } from '@/lib/jellyfin-client';
import { TmdbClient } from '@/lib/tmdb-client';
import { SeerrClient } from '@/lib/seerr-client';
import { resolveConnection, listConnections } from '@/lib/arr-instances';
import { getConnectionHeaders } from '@/lib/service-connection-secrets';

let cachedQBittorrentClient: QBittorrentClient | null = null;
let cachedQBittorrentConfigKey: string | null = null;

function buildJellyfinConnectionFingerprint(connection: ServiceConnection): string {
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
 * Create a QBittorrentClient from the QBITTORRENT service connection. qBittorrent
 * is single-instance, so findFirst returns the one configured connection.
 *
 * @returns A QBittorrentClient configured with the connection's URL, API key, and username (username defaults to `'admin'` if not set).
 * @throws Error if no QBITTORRENT service connection is configured.
 */
export async function getQBittorrentClient(): Promise<QBittorrentClient> {
  const connection = await prisma.serviceConnection.findFirst({
    where: { type: 'QBITTORRENT' },
  });

  if (!connection) {
    throw new ConfigurationError(
      'qBittorrent is not configured. Please add a qBittorrent connection in Settings.'
    );
  }

  const username = connection.username || 'admin';
  const customHeaders = getConnectionHeaders(connection);
  const configKey = `${connection.url}|${connection.apiKey}|${username}|${customHeaders ? stableStringify(customHeaders) : ''}`;

  if (!cachedQBittorrentClient || cachedQBittorrentConfigKey !== configKey) {
    cachedQBittorrentClient = new QBittorrentClient(connection.url, connection.apiKey, username, customHeaders);
    cachedQBittorrentConfigKey = configKey;
  }

  return cachedQBittorrentClient;
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
 * must not blank the whole library). The single fan-out used by all library-matching
 * consumers (discover, anime, watchlist, recommendations, random, library-gaps).
 */
export async function loadTaggedLibrary(): Promise<{ movies: Tagged<RadarrMovie>[]; series: Tagged<SonarrSeries>[] }> {
  const movies = (
    await Promise.all(
      (await getRadarrClients()).map(async ({ connection, client }) => {
        try {
          return (await client.getMovies()).map((m) => ({ ...m, instanceId: connection.id, instanceLabel: connection.label }));
        } catch {
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
          return [] as Tagged<SonarrSeries>[];
        }
      })
    )
  ).flat();
  return { movies, series };
}
