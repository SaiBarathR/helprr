import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { inReencodeWindow } from '@/lib/archive/reencode-window';

const ONLINE_WITHIN_MS = 45_000;

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.view');
  if (!auth.ok) return auth.response;

  const [heartbeat, settings, youtube] = await Promise.all([
    prisma.archiveWorkerHeartbeat.findFirst({ orderBy: { lastSeenAt: 'desc' } }),
    prisma.archiveSettings.findUnique({
      where: { id: 'singleton' },
      select: { toolLatest: true, toolsPausedAt: true, toolUpdateRequestedAt: true, reencodeEnabled: true, reencodeWindowStart: true, reencodeWindowEnd: true },
    }),
    prisma.youtubeSettings.findUnique({ where: { id: 'singleton' }, select: { toolsPausedAt: true } }),
  ]);
  if (!heartbeat) return NextResponse.json({ online: false, seen: false });
  return NextResponse.json({
    online: Date.now() - heartbeat.lastSeenAt.getTime() < ONLINE_WITHIN_MS,
    seen: true,
    lastSeenAt: heartbeat.lastSeenAt,
    version: heartbeat.version,
    // The page shows one yt-dlp, and on this platform that is YouTube's own.
    tools: { ytdlp: (heartbeat.tools as { ytdlpYoutube?: string | null } | null)?.ytdlpYoutube ?? null },
    toolLatest: { ytdlp: (settings?.toolLatest as { ytdlp?: string } | null)?.ytdlp },
    toolsPaused: Boolean(youtube?.toolsPausedAt),
    toolUpdatePending: Boolean(settings?.toolUpdateRequestedAt),
    gpuAvailable: heartbeat.gpuAvailable,
    reencodeWindow: settings?.reencodeEnabled
      ? { open: inReencodeWindow(new Date(), settings.reencodeWindowStart, settings.reencodeWindowEnd), start: settings.reencodeWindowStart }
      : null,
    diskFreeBytes: heartbeat.diskFreeBytes === null ? null : Number(heartbeat.diskFreeBytes),
    diskTotalBytes: heartbeat.diskTotalBytes === null ? null : Number(heartbeat.diskTotalBytes),
    lanes: heartbeat.lanes,
  });
}

export const GET = withApiLogging(getHandler, 'api/youtube/worker');
