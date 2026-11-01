import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { quotaState, storedApiKey } from '@/lib/youtube/api';
import { getYoutubeSettings } from '@/lib/youtube/settings';

const WORKER_ONLINE_MS = 45_000;

interface RootState {
  available?: boolean;
  freeBytes?: number | null;
}

/** Everything the setup list needs. Says what is ready, and never returns a secret. */
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.manage');
  if (!auth.ok) return auth.response;

  const [settings, key, quota, heartbeat] = await Promise.all([
    getYoutubeSettings(),
    storedApiKey(),
    quotaState(),
    prisma.archiveWorkerHeartbeat.findFirst({ orderBy: { lastSeenAt: 'desc' }, select: { lastSeenAt: true, platforms: true, roots: true } }),
  ]);
  const online = heartbeat ? Date.now() - heartbeat.lastSeenAt.getTime() < WORKER_ONLINE_MS : false;
  const roots = (heartbeat?.roots ?? {}) as Record<string, RootState>;
  const platforms = Array.isArray(heartbeat?.platforms) ? heartbeat.platforms : [];
  return NextResponse.json({
    apiKey: Boolean(key),
    quota: { used: quota.used, limit: quota.limit, searches: quota.searches, searchLimit: quota.searchLimit },
    worker: { online, supportsYoutube: platforms.includes('YOUTUBE') },
    library: { mounted: roots.YOUTUBE?.available === true, jellyfinLibrary: Boolean(settings.jellyfinLibraryItemId) },
    account: Boolean(settings.cookies),
    cleanup: settings.autoCleanupEnabled,
  });
}

export const GET = withApiLogging(getHandler, 'api/youtube/setup');
