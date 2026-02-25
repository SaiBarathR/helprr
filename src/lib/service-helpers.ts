import { prisma } from '@/lib/db';
import { SonarrClient } from '@/lib/sonarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { QBittorrentClient } from '@/lib/qbittorrent-client';
import { ProwlarrClient } from '@/lib/prowlarr-client';
import { JellyfinClient } from '@/lib/jellyfin-client';
import { TmdbClient } from '@/lib/tmdb-client';

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

  return new QBittorrentClient(connection.url, connection.apiKey, connection.username || 'admin');
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

  return new JellyfinClient(connection.url, connection.apiKey, connection.username);
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
