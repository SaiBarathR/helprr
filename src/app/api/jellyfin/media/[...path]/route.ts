import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { getConnectionHeaders } from '@/lib/service-connection-secrets';
import { canUserAccessItem } from '@/lib/jellyfin-playback/item-access';
import {
  isAllowedMediaPath,
  isHlsPlaylist,
  itemIdFromMediaPath,
  normalizeMediaPath,
  stripSensitiveQuery,
} from '@/lib/jellyfin-playback/media-path';
import { rewriteHlsPlaylist } from '@/lib/jellyfin-playback/hls-rewrite';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

const PASS_REQUEST_HEADERS = ['range', 'accept', 'accept-encoding', 'if-range', 'if-modified-since', 'if-none-match'];
const PASS_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
  'cache-control',
];

async function forward(request: NextRequest, pathSegments: string[], user: User): Promise<Response> {

  const joined = `/${pathSegments.map((segment) => decodeURIComponent(segment)).join('/')}`;
  const path = normalizeMediaPath(joined);
  if (!path || !isAllowedMediaPath(path)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const itemId = itemIdFromMediaPath(path);
  if (itemId) {
    const allowed = await canUserAccessItem(user, itemId);
    if (!allowed) {
      return new NextResponse(null, { status: 404 });
    }
  } else if (!/^\/fallbackfont\b/i.test(path)) {
    // Everything playback-related carries an item id and is access-checked
    // above. The only exception is the static fallback font libass needs.
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const connection = await prisma.serviceConnection.findFirst({ where: { type: 'JELLYFIN' } });
  if (!connection) {
    return new NextResponse(null, { status: 404 });
  }

  const connectionBase = new URL(connection.url);
  connectionBase.hash = '';
  const origin = connectionBase.origin;
  const basePath = connectionBase.pathname.replace(/\/+$/, '');
  const upstreamPath = `${basePath}${path}`;
  const query = stripSensitiveQuery(new URL(request.url).searchParams);
  const upstreamUrl = new URL(upstreamPath, `${origin}/`);
  upstreamUrl.search = query.toString();
  if (upstreamUrl.origin !== origin) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const headers = new Headers({
    ...getConnectionHeaders(connection),
    Authorization: `MediaBrowser Token="${connection.apiKey}"`,
    'X-Emby-Token': connection.apiKey,
  });
  for (const name of PASS_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    signal: request.signal,
    redirect: 'manual',
  });

  if (upstream.status >= 300 && upstream.status < 400) {
    return new NextResponse(null, { status: 404 });
  }

  const contentType = upstream.headers.get('content-type');
  if (request.method === 'GET' && isHlsPlaylist(path, contentType)) {
    const body = await upstream.text();
    const rewritten = rewriteHlsPlaylist(body, origin, path);
    return new NextResponse(rewritten, {
      status: upstream.status,
      headers: {
        'Content-Type': contentType || 'application/vnd.apple.mpegurl',
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie',
      },
    });
  }

  const responseHeaders = new Headers();
  for (const name of PASS_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value && !HOP_BY_HOP.has(name)) responseHeaders.set(name, value);
  }
  responseHeaders.set('Cache-Control', 'private, no-store');
  responseHeaders.set('Vary', 'Cookie');

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;
  const { path } = await context.params;
  return forward(request, path ?? [], auth.user);
}

export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;
  const { path } = await context.params;
  return forward(request, path ?? [], auth.user);
}
