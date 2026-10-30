import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { layerMap, sanitizeLayer } from '@/lib/twitch/policy';
import { getTwitchSettings } from '@/lib/twitch/settings';

const json = (value: unknown) => value as Prisma.InputJsonValue;

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  const streamerId = request.nextUrl.searchParams.get('streamerId');
  const settings = await getTwitchSettings();
  const stored = streamerId
    ? await prisma.twitchStreamerPolicy.findUnique({ where: { streamerId } })
    : null;
  return NextResponse.json({
    defaultPolicy: sanitizeLayer(settings.defaultPolicy),
    typePolicies: layerMap(settings.typePolicies),
    streamer: stored ? { policy: sanitizeLayer(stored.policy), typePolicies: layerMap(stored.typePolicies) } : null,
  });
}

async function putHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  if (typeof body.streamerId === 'string') {
    const streamer = await prisma.twitchStreamer.findUnique({ where: { id: body.streamerId }, select: { id: true } });
    if (!streamer) return NextResponse.json({ error: 'Streamer not found' }, { status: 404 });
    const data = { policy: json(sanitizeLayer(body.policy)), typePolicies: json(layerMap(body.typePolicies)) };
    await prisma.twitchStreamerPolicy.upsert({ where: { streamerId: streamer.id }, update: data, create: { streamerId: streamer.id, ...data } });
  } else {
    await getTwitchSettings();
    await prisma.twitchSettings.update({
      where: { id: 'singleton' },
      data: { defaultPolicy: json(sanitizeLayer(body.defaultPolicy)), typePolicies: json(layerMap(body.typePolicies)) },
    });
  }
  return NextResponse.json({ ok: true });
}

export const GET = withApiLogging(getHandler, 'api/twitch/policies');
export const PUT = withApiLogging(putHandler, 'api/twitch/policies');
