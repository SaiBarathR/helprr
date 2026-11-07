import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { isChannelType } from '@/lib/notification-channels/catalog';
import {
  decryptSecrets,
  encryptSecrets,
  serializeChannel,
  toFieldMap,
  validateChannelInput,
} from '@/lib/notification-channels/config';
import { parseChannelEvents, parseChannelName } from '@/lib/notification-channels/requests';

type RouteContext = { params: Promise<{ id: string }> };

async function patchHandler(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.notifications');
  if (!auth.ok) return auth.response;
  const user = auth.user;
  const { id } = await params;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    // Another user's channel is "not found", admin or not.
    const existing = await prisma.notificationChannel.findFirst({ where: { id, userId: user.id } });
    if (!existing || !isChannelType(existing.type)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const data: Prisma.NotificationChannelUpdateInput = {};
    if (body.name !== undefined) {
      const name = parseChannelName(body.name);
      if (!name) return NextResponse.json({ error: 'Enter a name (up to 60 characters)' }, { status: 400 });
      data.name = name;
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be true or false' }, { status: 400 });
      data.enabled = body.enabled;
    }
    if (body.events !== undefined) {
      const events = parseChannelEvents(user, body.events);
      if (!events) return NextResponse.json({ error: 'events must be a list' }, { status: 400 });
      data.events = events;
    }
    if (body.config !== undefined || body.secrets !== undefined) {
      const stored = decryptSecrets(existing.secrets);
      const storedConfig = toFieldMap(existing.config);
      const configIn = body.config && typeof body.config === 'object' && !Array.isArray(body.config) ? body.config : {};
      const input = validateChannelInput(
        existing.type,
        // Fields left out keep their stored value; an empty string clears an optional one.
        { ...storedConfig, ...configIn },
        body.secrets,
        {
          allowPrivate: user.role === 'admin',
          // Unreadable secrets cannot be kept: every secret field must be entered again.
          existing: { config: storedConfig, secrets: stored ?? {} },
        },
      );
      if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
      data.config = input.config;
      data.secrets = encryptSecrets(input.secrets);
      // New settings get a fresh start: no backoff from the old address.
      data.consecutiveFailures = 0;
      data.lastFailedAt = null;
      data.lastError = null;
    }

    const row = await prisma.notificationChannel.update({ where: { id: existing.id }, data });
    return NextResponse.json(serializeChannel(row));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'You already have a channel with this name' }, { status: 409 });
    }
    return upstreamErrorResponse(error, 'Failed');
  }
}

async function deleteHandler(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.notifications');
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const result = await prisma.notificationChannel.deleteMany({ where: { id, userId: auth.user.id } });
    if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed');
  }
}

// Bodies carry channel secrets: never logged.
export const PATCH = withApiLogging(patchHandler, 'api/notifications/channels/[id]', { logBodies: false });
export const DELETE = withApiLogging(deleteHandler, 'api/notifications/channels/[id]', { logBodies: false });
