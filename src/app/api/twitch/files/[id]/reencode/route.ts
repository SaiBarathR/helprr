import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { requestReencode } from '@/lib/twitch/files';

async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as { when?: unknown } | null;
  if (body?.when !== 'now' && body?.when !== 'tonight') {
    return NextResponse.json({ error: 'when must be now or tonight' }, { status: 400 });
  }

  // Either would sit in the queue with nothing to say why.
  const [heartbeat, settings] = await Promise.all([
    prisma.twitchWorkerHeartbeat.findFirst({ orderBy: { lastSeenAt: 'desc' }, select: { gpuAvailable: true } }),
    prisma.twitchSettings.findUnique({ where: { id: 'singleton' }, select: { reencodeEnabled: true } }),
  ]);
  if (heartbeat && !heartbeat.gpuAvailable) {
    return NextResponse.json({ error: 'Re-encoding needs an Intel GPU, and the worker has none' }, { status: 409 });
  }
  if (body.when === 'tonight' && !settings?.reencodeEnabled) {
    return NextResponse.json({ error: 'Night re-encoding is off in Settings' }, { status: 409 });
  }

  const { id } = await params;
  const result = await requestReencode(id, body.when, auth.user);
  if (result === 'missing') return NextResponse.json({ error: 'File not found' }, { status: 404 });
  if (result === 'nothing-to-do') return NextResponse.json({ error: 'This file is already HEVC' }, { status: 409 });
  if (result === 'busy') return NextResponse.json({ error: 'Another job is working on this file' }, { status: 409 });
  return NextResponse.json({ ok: true }, { status: 202 });
}

export const POST = withApiLogging(postHandler, 'api/twitch/files/[id]/reencode');
