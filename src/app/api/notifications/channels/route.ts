import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { isChannelType, MAX_CHANNELS_PER_USER } from '@/lib/notification-channels/catalog';
import { encryptSecrets, serializeChannel, validateChannelInput } from '@/lib/notification-channels/config';
import { parseChannelEvents, parseChannelName, receivableEventTypes } from '@/lib/notification-channels/requests';

// Everyone sees and changes only their own channels, admins included. An admin
// also gets counts of everyone's, never their settings or secrets.

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.notifications');
  if (!auth.ok) return auth.response;
  const user = auth.user;

  try {
    const rows = await prisma.notificationChannel.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    let overview: { total: number; enabled: number; failing: number; people: number; byType: Record<string, number> } | undefined;
    if (user.role === 'admin') {
      const all = await prisma.notificationChannel.findMany({
        select: { userId: true, type: true, enabled: true, consecutiveFailures: true },
      });
      const byType: Record<string, number> = {};
      for (const row of all) byType[row.type] = (byType[row.type] ?? 0) + 1;
      overview = {
        total: all.length,
        enabled: all.filter((row) => row.enabled).length,
        failing: all.filter((row) => row.enabled && row.consecutiveFailures > 0).length,
        people: new Set(all.map((row) => row.userId)).size,
        byType,
      };
    }
    return NextResponse.json({
      channels: rows.map(serializeChannel),
      availableEvents: receivableEventTypes(user),
      ...(overview ? { overview } : {}),
    });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed');
  }
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.notifications');
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  if (!isChannelType(body.type)) return NextResponse.json({ error: 'Choose a channel type' }, { status: 400 });
  const name = parseChannelName(body.name);
  if (!name) return NextResponse.json({ error: 'Enter a name (up to 60 characters)' }, { status: 400 });
  const events = body.events === undefined ? receivableEventTypes(user) : parseChannelEvents(user, body.events);
  if (!events) return NextResponse.json({ error: 'events must be a list' }, { status: 400 });
  const input = validateChannelInput(body.type, body.config, body.secrets, { allowPrivate: user.role === 'admin' });
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

  try {
    const count = await prisma.notificationChannel.count({ where: { userId: user.id } });
    if (count >= MAX_CHANNELS_PER_USER) {
      return NextResponse.json({ error: `You can have up to ${MAX_CHANNELS_PER_USER} channels` }, { status: 400 });
    }
    const row = await prisma.notificationChannel.create({
      data: {
        userId: user.id,
        type: body.type,
        name,
        enabled: body.enabled !== false,
        events,
        config: input.config,
        secrets: encryptSecrets(input.secrets),
      },
    });
    return NextResponse.json(serializeChannel(row), { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'You already have a channel with this name' }, { status: 409 });
    }
    return upstreamErrorResponse(error, 'Failed');
  }
}

// Bodies carry channel secrets: never logged.
export const GET = withApiLogging(getHandler, 'api/notifications/channels', { logBodies: false });
export const POST = withApiLogging(postHandler, 'api/notifications/channels', { logBodies: false });
