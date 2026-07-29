import type { ServiceType } from '@prisma/client';
import { prisma } from '@/lib/db';

const APP_SHELL_SERVICE_TYPES = ['SEERR', 'TMDB', 'JELLYFIN'] satisfies ServiceType[];

export async function getAppShellServiceFlags(): Promise<{
  seerrConfigured: boolean;
  tmdbConfigured: boolean;
  jellyfinConfigured: boolean;
}> {
  const connections = await prisma.serviceConnection.findMany({
    where: { type: { in: APP_SHELL_SERVICE_TYPES } },
    distinct: ['type'],
    select: { type: true },
  });
  const configured = new Set(connections.map((connection) => connection.type));

  return {
    seerrConfigured: configured.has('SEERR'),
    tmdbConfigured: configured.has('TMDB'),
    jellyfinConfigured: configured.has('JELLYFIN'),
  };
}
