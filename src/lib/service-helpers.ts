import type { ServiceConnection, User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { sha256Hex, stableStringify } from '@/lib/cache/keys';
import { SonarrClient } from '@/lib/sonarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { QBittorrentClient } from '@/lib/qbittorrent-client';
import { ProwlarrClient } from '@/lib/prowlarr-client';
import { JellyfinClient } from '@/lib/jellyfin-client';
import { TmdbClient } from '@/lib/tmdb-client';
import { SeerrClient } from '@/lib/seerr-client';

let cachedQBittorrentClient: QBittorrentClient | null = null;
let cachedQBittorrentConfigKey: string | null = null;

function buildJellyfinConnectionFingerprint(connection: ServiceConnection): string {
  return sha256Hex(stableStringify({
    apiKey: connection.apiKey,
    url: connection.url,
    username: connection.username ?? null,
  }));
}

/**
 * Create a SonarrClient configured from the stored SONARR service connection.
 *
 * @returns A SonarrClient configured with the stored connection's URL and API key.
 * @throws Error if no SONARR service connection is configured.
 */
export async function getSonarrClient(): Promise<SonarrClient> {
  const connection = await prisma.serviceConnection.findUnique({
    where: { type: 'SONARR' },
  });

  if (!connection) {
    throw new Error(
      'Sonarr is not configured. Please add a Sonarr connection in Settings.'
    );
  }

  return new SonarrClient(connection.url, connection.apiKey);
}

export async function getRadarrClient(): Promise<RadarrClient> {
  const connection = await prisma.serviceConnection.findUnique({
    where: { type: 'RADARR' },
  });

  if (!connection) {
    throw new Error(
      'Radarr is not configured. Please add a Radarr connection in Settings.'
    );
  }

  return new RadarrClient(connection.url, connection.apiKey);
}

/**
 * Create a QBittorrentClient using the stored QBITTORRENT service connection.
 *
 * @returns A QBittorrentClient configured with the connection's URL, API key, and username (username defaults to `'admin'` if not set).
 * @throws Error if no QBITTORRENT service connection is configured.
 */
export async function getQBittorrentClient(): Promise<QBittorrentClient> {
  const connection = await prisma.serviceConnection.findUnique({
    where: { type: 'QBITTORRENT' },
  });

  if (!connection) {
    throw new Error(
      'qBittorrent is not configured. Please add a qBittorrent connection in Settings.'
    );
  }

  const username = connection.username || 'admin';
  const configKey = `${connection.url}|${connection.apiKey}|${username}`;

  if (!cachedQBittorrentClient || cachedQBittorrentConfigKey !== configKey) {
    cachedQBittorrentClient = new QBittorrentClient(connection.url, connection.apiKey, username);
    cachedQBittorrentConfigKey = configKey;
  }

  return cachedQBittorrentClient;
}

/**
 * Creates a Prowlarr client from the configured PROWLARR service connection.
 *
 * @returns A configured ProwlarrClient instance
 * @throws Error if no PROWLARR connection is found in the database
 */
export async function getProwlarrClient(): Promise<ProwlarrClient> {
  const connection = await prisma.serviceConnection.findUnique({
    where: { type: 'PROWLARR' },
  });

  if (!connection) {
    throw new Error(
      'Prowlarr is not configured. Please add a Prowlarr connection in Settings.'
    );
  }

  return new ProwlarrClient(connection.url, connection.apiKey);
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
  const connection = await prisma.serviceConnection.findUnique({
    where: { type: 'JELLYFIN' },
  });

  if (!connection) {
    throw new Error(
      'Jellyfin is not configured. Please add a Jellyfin connection in Settings.'
    );
  }

  if (!connection.username) {
    throw new Error(
      'Jellyfin user context is missing. Re-test and save the Jellyfin connection in Settings.'
    );
  }

  return {
    client: new JellyfinClient(connection.url, connection.apiKey, connection.username),
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
 * Jellyfin client scoped to a specific Helprr user. Uses the admin API key (which
 * can read any user's user-scoped endpoints) but the *member's* jellyfinUserId, so
 * a member sees their own resume/history — never the admin's. Admins fall back to
 * the connection's configured user when they have no personal link (preserves
 * pre-multi-user behavior).
 */
export async function getJellyfinClientForUser(
  user: Pick<User, 'role' | 'jellyfinUserId'>
): Promise<JellyfinClient> {
  const connection = await prisma.serviceConnection.findUnique({ where: { type: 'JELLYFIN' } });
  if (!connection) {
    throw new Error('Jellyfin is not configured. Please add a Jellyfin connection in Settings.');
  }

  const userId =
    user.role === 'admin' ? user.jellyfinUserId ?? connection.username ?? null : user.jellyfinUserId;
  if (!userId) {
    throw new JellyfinNotLinkedError();
  }

  return new JellyfinClient(connection.url, connection.apiKey, userId);
}

export async function getSeerrClient(): Promise<SeerrClient> {
  const connection = await prisma.serviceConnection.findUnique({
    where: { type: 'SEERR' },
  });

  if (!connection) {
    throw new Error('Seerr is not configured. Please add a Seerr connection in Settings.');
  }

  return new SeerrClient(connection.url, connection.apiKey);
}

export async function getTMDBClient(): Promise<TmdbClient> {
  const connection = await prisma.serviceConnection.findUnique({
    where: { type: 'TMDB' },
  });

  if (!connection) {
    throw new Error('TMDB is not configured. Please add a TMDB connection in Settings.');
  }

  return new TmdbClient(connection.url, connection.apiKey);
}
