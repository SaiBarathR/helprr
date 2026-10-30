import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';

const ONLINE_WITHIN_MS = 45_000;

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const heartbeat = await prisma.twitchWorkerHeartbeat.findFirst({ orderBy: { lastSeenAt: 'desc' } });
  if (!heartbeat) return NextResponse.json({ online: false, seen: false });
  return NextResponse.json({
    online: Date.now() - heartbeat.lastSeenAt.getTime() < ONLINE_WITHIN_MS,
    seen: true,
    lastSeenAt: heartbeat.lastSeenAt,
    version: heartbeat.version,
    tools: heartbeat.tools,
    gpuAvailable: heartbeat.gpuAvailable,
    diskFreeBytes: heartbeat.diskFreeBytes === null ? null : Number(heartbeat.diskFreeBytes),
    diskTotalBytes: heartbeat.diskTotalBytes === null ? null : Number(heartbeat.diskTotalBytes),
    lanes: heartbeat.lanes,
  });
}

export const GET = withApiLogging(getHandler, 'api/twitch/worker');
