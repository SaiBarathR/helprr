import { isAxiosError } from 'axios';
import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { boundedBodyErrorResponse, readBoundedJson } from '@/lib/server/bounded-body';
import { prisma } from '@/lib/db';
import { recordSecurityEvent, serviceTargetLabel } from '@/lib/security-audit';
import {
  IMPLEMENTATION_BY_TYPE,
  PROWLARR_SYNC_LEVELS,
  buildNewApplication,
  guessProwlarrUrl,
  hasApplicationAt,
} from '@/lib/prowlarr-applications';
import type { ProwlarrSyncLevel } from '@/lib/prowlarr-client';

// Adding an app hands one of Helprr's arr API keys to Prowlarr, so this is an
// admin's, like the connection itself. The key goes from Helprr's database to
// Prowlarr server to server: no response, log line or audit row holds it.
// Unlike editing a connection (/api/services asks for the key again when its
// address changes), the arr address here is the admin's to type: under Docker
// Prowlarr reaches the arr by another name than Helprr does, which is the point
// of the form. An admin can already export the keys, so this exposes nothing new.

const ALLOWED_KEYS = new Set(['connectionId', 'name', 'baseUrl', 'prowlarrUrl', 'syncLevel', 'testOnly']);
const MAX_NAME = 100;
const MAX_URL = 2048;

interface AddInput {
  connectionId: string;
  name: string;
  baseUrl: string;
  prowlarrUrl: string;
  syncLevel: ProwlarrSyncLevel;
  testOnly: boolean;
}

function isConnectionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

/**
 * An http(s) base address, without a trailing slash: no user name or password
 * (Prowlarr shows its URLs in clear), and no query or fragment, which Prowlarr
 * would keep in front of every API path.
 */
function parseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_URL) return null;
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null;
    if (url.search || url.hash) return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function parseAdd(body: unknown): AddInput | string {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return 'Invalid JSON body';
  const record = body as Record<string, unknown>;
  const unknownKey = Object.keys(record).find((key) => !ALLOWED_KEYS.has(key));
  if (unknownKey) return `Unsupported field: ${unknownKey}`;

  const { connectionId, name, baseUrl, prowlarrUrl, syncLevel, testOnly } = record;
  if (!isConnectionId(connectionId)) return 'connectionId is required';
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName || trimmedName.length > MAX_NAME || /[\u0000-\u001f\u007f]/.test(trimmedName)) {
    return `name must be 1 to ${MAX_NAME} characters`;
  }
  const arrUrl = parseUrl(baseUrl);
  if (!arrUrl) return 'baseUrl must be an http or https address';
  const backUrl = parseUrl(prowlarrUrl);
  if (!backUrl) return 'prowlarrUrl must be an http or https address';
  if (typeof syncLevel !== 'string' || !(PROWLARR_SYNC_LEVELS as readonly string[]).includes(syncLevel)) {
    return 'syncLevel must be disabled, addOnly or fullSync';
  }
  if (testOnly !== undefined && typeof testOnly !== 'boolean') return 'testOnly must be true or false';
  return {
    connectionId,
    name: trimmedName,
    baseUrl: arrUrl,
    prowlarrUrl: backUrl,
    syncLevel: syncLevel as ProwlarrSyncLevel,
    testOnly: testOnly === true,
  };
}

function findArrConnection(id: string) {
  return prisma.serviceConnection.findFirst({
    where: { id, type: { in: ['SONARR', 'RADARR', 'LIDARR'] } },
    select: { id: true, type: true, url: true, apiKey: true, label: true },
  });
}

/**
 * What the add form starts from: a name, and guesses for the two addresses that
 * differ under Docker (how Prowlarr reaches the arr, how the arr reaches
 * Prowlarr). Only for an admin; the arr's API key is not part of it.
 */
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const connectionId = new URL(request.url).searchParams.get('connectionId');
  if (!isConnectionId(connectionId)) return NextResponse.json({ error: 'connectionId is required' }, { status: 400 });

  try {
    const connection = await findArrConnection(connectionId);
    if (!connection) return NextResponse.json({ error: 'That connection no longer exists' }, { status: 404 });
    const prowlarr = await prisma.serviceConnection.findFirst({ where: { type: 'PROWLARR' }, select: { url: true } });
    const client = await getProwlarrClient();
    const applications = await client.getApplications();
    const implementation = IMPLEMENTATION_BY_TYPE[connection.type];
    const label = connection.label || implementation;
    const taken = applications.some((application) => application.name.toLowerCase() === label.toLowerCase());
    return NextResponse.json({
      implementation,
      name: taken ? `${label} (Helprr)` : label,
      baseUrl: connection.url.replace(/\/+$/, ''),
      prowlarrUrl: guessProwlarrUrl(applications, prowlarr?.url ?? ''),
    });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to prepare the app');
  }
}

/**
 * Test, then (unless `testOnly`) add a Helprr arr connection as a Prowlarr app,
 * built from Prowlarr's own template for that arr. Prowlarr's reason for a
 * failed test is passed on (its URLs cut to their origin by the client): the
 * admin needs it to fix an address.
 */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  // JSON only: this takes no password and sends the arr's API key to the
  // address in the body, and a form on a sibling subdomain (the same site, for
  // the session cookie) can post text/plain, not JSON, without the browser asking.
  let body: unknown;
  try {
    body = await readBoundedJson(request, 4096);
  } catch (error) {
    const refused = boundedBodyErrorResponse(error);
    if (refused) return refused;
    throw error;
  }
  const input = parseAdd(body);
  if (typeof input === 'string') return NextResponse.json({ error: input }, { status: 400 });

  let apiKey = '';
  try {
    const connection = await findArrConnection(input.connectionId);
    if (!connection) return NextResponse.json({ error: 'That connection no longer exists' }, { status: 404 });
    apiKey = connection.apiKey;
    const implementation = IMPLEMENTATION_BY_TYPE[connection.type];

    const client = await getProwlarrClient();
    if (hasApplicationAt(await client.getApplications(), implementation, input.baseUrl)) {
      return NextResponse.json({ error: `Prowlarr already has a ${implementation} app at that address` }, { status: 409 });
    }
    const template = (await client.getApplicationTemplates()).find((candidate) => candidate.implementation === implementation);
    const application = template && buildNewApplication(template, { ...input, apiKey });
    if (!application) {
      return NextResponse.json({ error: `This Prowlarr has no ${implementation} app form Helprr can fill. Add it in Prowlarr.` }, { status: 502 });
    }

    try {
      await client.testNewApplication(application);
    } catch (error) {
      return refusal(error, apiKey, 'Test failed');
    }
    if (input.testOnly) return NextResponse.json({ ok: true });

    let created: { id: number; name: string };
    try {
      created = await client.addApplication(application);
    } catch (error) {
      return refusal(error, apiKey, 'Failed to add the app');
    }

    const prowlarr = await prisma.serviceConnection.findFirst({ where: { type: 'PROWLARR' }, select: { id: true, label: true } });
    console.info(`[prowlarr] ${auth.user.username} added ${serviceTargetLabel(connection.type, connection.label)} to Prowlarr as app ${created.id}`);
    await recordSecurityEvent(request, {
      actor: auth.user,
      action: 'SERVICE_UPDATED',
      targetType: 'service',
      targetId: prowlarr?.id ?? null,
      targetLabel: serviceTargetLabel('PROWLARR', prowlarr?.label ?? ''),
      fields: [`app added: ${created.name}`, `from ${serviceTargetLabel(connection.type, connection.label)}`],
    });
    return NextResponse.json({ id: created.id, name: created.name });
  } catch (error) {
    return upstreamErrorResponse(scrub(error, apiKey), 'Failed to add the app');
  }
}

/** An error with the arr's key taken out of its message, in case an upstream ever quotes it. */
function scrub(error: unknown, apiKey: string): unknown {
  if (!apiKey || !(error instanceof Error) || !error.message.includes(apiKey)) return error;
  return new Error(error.message.replaceAll(apiKey, '[redacted]'));
}

/**
 * Prowlarr's validation failures (a test that could not reach the arr, a name
 * already taken) come back as plain errors carrying its message, and are
 * passed on; a network failure or anything else gets the fixed message.
 */
function refusal(error: unknown, apiKey: string, fallback: string): NextResponse {
  const scrubbed = scrub(error, apiKey);
  if (scrubbed instanceof Error && !isAxiosError(scrubbed)) {
    console.error(`[api] ${fallback}:`, scrubbed.message);
    return NextResponse.json({ error: `${fallback}: ${scrubbed.message}` }, { status: 400 });
  }
  return upstreamErrorResponse(scrubbed, fallback);
}

export const GET = withApiLogging(getHandler, 'api/prowlarr/applications/from-connection');
export const POST = withApiLogging(postHandler, 'api/prowlarr/applications/from-connection');
