import { prisma } from '@/lib/db';
import { SonarrClient } from '@/lib/sonarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { QBittorrentClient } from '@/lib/qbittorrent-client';

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
