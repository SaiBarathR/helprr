import { prisma } from '@/lib/db';
import { resolveConnection } from '@/lib/arr-instances';
import type { SeerrArrServer } from '@/lib/seerr-client';
import { getSeerrClient } from '@/lib/service-helpers';
import { endpoint, seerrServerUrl } from '@/lib/service-import';

// The add pages open on Seerr's default quality profile and root folder for the
// same Sonarr/Radarr, when nothing is remembered for that instance. A convenience,
// so it never waits long and never fails the page: any problem reads as "none".

/** Seerr is asked with a short timeout: the add page waits for this before defaulting. */
const SEERR_TIMEOUT_MS = 4000;

export interface SeerrAddDefaults {
  profileId: string | null;
  rootFolder: string | null;
  /**
   * Sonarr only, for a series added as anime: Seerr's anime profile and folder,
   * each falling back to the regular one as Seerr's own anime requests do.
   */
  anime?: { profileId: string | null; rootFolder: string | null };
}

const NONE: SeerrAddDefaults = { profileId: null, rootFolder: null };

/**
 * Seerr's server entry for this Helprr instance: same API key (one per Sonarr/Radarr)
 * or same address. Seerr may list one app twice (a 4K server); the regular default
 * server wins, then any regular one.
 */
export function matchSeerrServer(
  servers: SeerrArrServer[],
  instance: { url: string; apiKey: string },
): SeerrArrServer | null {
  const address = endpoint(instance.url);
  const matches = servers.filter((server) => {
    if (!server || typeof server !== 'object') return false;
    if (server.apiKey && server.apiKey === instance.apiKey) return true;
    if (typeof server.hostname !== 'string' || !server.hostname || !Number.isInteger(server.port)) return false;
    return address !== null && endpoint(seerrServerUrl(server)) === address;
  });
  return matches.find((server) => server.isDefault && !server.is4k)
    ?? matches.find((server) => !server.is4k)
    ?? matches[0]
    ?? null;
}

function defaultsOf(profileId: unknown, directory: unknown): SeerrAddDefaults {
  return {
    profileId: Number.isInteger(profileId) ? String(profileId) : null,
    rootFolder: typeof directory === 'string' && directory ? directory : null,
  };
}

export async function getSeerrAddDefaults(kind: 'sonarr' | 'radarr', instanceId: string | undefined): Promise<SeerrAddDefaults> {
  try {
    if (!(await prisma.serviceConnection.findFirst({ where: { type: 'SEERR' }, select: { id: true } }))) return NONE;
    const instance = await resolveConnection(kind === 'sonarr' ? 'SONARR' : 'RADARR', instanceId);
    const servers = await (await getSeerrClient()).getArrServers(kind, SEERR_TIMEOUT_MS);
    if (!Array.isArray(servers)) return NONE;
    const server = matchSeerrServer(servers, instance);
    if (!server) return NONE;
    const regular = defaultsOf(server.activeProfileId, server.activeDirectory);
    if (kind === 'radarr') return regular;
    const anime = defaultsOf(server.activeAnimeProfileId, server.activeAnimeDirectory);
    return {
      ...regular,
      anime: { profileId: anime.profileId ?? regular.profileId, rootFolder: anime.rootFolder ?? regular.rootFolder },
    };
  } catch (error) {
    console.warn(`[SeerrAddDefaults] ${kind} defaults unavailable: ${error instanceof Error ? error.name : 'unknown error'}`);
    return NONE;
  }
}
