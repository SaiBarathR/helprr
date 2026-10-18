import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { getConnectionHeaders } from '@/lib/service-connection-secrets';
import { invalidateJellyfinToken, readJellyfinToken } from '@/lib/jellyfin-token';
import { canUserAccessItem } from '@/lib/jellyfin-playback/item-access';
import { bindHlsPlaylist, hlsPlaylistBelongsTo, liveStreamBelongsTo, playSessionBelongsTo } from '@/lib/jellyfin-playback/live-stream-binding';
import {
  isAllowedMediaPath,
  isHlsPlaylist,
  isLegacyHlsFileOf,
  itemIdFromMediaPath,
  legacyHlsPlaylistIds,
  legacyHlsTarget,
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

// Second line behind the allowlist check: the path the URL parser actually
// produced, decoded and without the configured base path, must still be an
// allowed media path. Compared decoded because the parser encodes spaces.
function resolvedPathStillAllowed(pathname: string, basePath: string): boolean {
  if (!pathname.startsWith(`${basePath}/`)) return false;
  try {
    return isAllowedMediaPath(decodeURIComponent(pathname.slice(basePath.length)));
  } catch {
    return false;
  }
}

// Path ids come in GUID form and catalog ids without dashes; both name one item.
const sameItemId = (id: string) => id.toLowerCase().replace(/-/g, '');

async function forward(request: NextRequest, pathSegments: string[], user: User): Promise<Response> {

  // Next has already decoded each segment once; decoding again would let a
  // double-encoded value change shape after the checks below.
  const joined = `/${pathSegments.join('/')}`;
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
    // Jellyfin reads query names case-insensitively, so every spelling counts.
    // A live stream or play session id selects a stream on its own, whatever
    // item the path names, so it must be one opened for this user and item.
    // `Params` packs those ids (and more) into one value; Helprr never sends it.
    for (const [name, value] of new URL(request.url).searchParams) {
      const lower = name.toLowerCase();
      if (lower === 'params') return new NextResponse(null, { status: 404 });
      // Some routes (subtitles) take a query itemId over the path's: only the checked one.
      if (lower === 'itemid' && sameItemId(value) !== sameItemId(itemId)) return new NextResponse(null, { status: 404 });
      if (lower === 'livestreamid' && value && !(await liveStreamBelongsTo(user.id, value, itemId))) {
        return new NextResponse(null, { status: 404 });
      }
      if (lower === 'playsessionid' && value && !(await playSessionBelongsTo(user.id, value, itemId))) {
        return new NextResponse(null, { status: 404 });
      }
    }
    const legacy = legacyHlsTarget(path);
    if (legacy && (!isLegacyHlsFileOf(legacy.playlistId, legacy.file)
      || !(await hlsPlaylistBelongsTo(user.id, legacy.playlistId, itemId)))) {
      return new NextResponse(null, { status: 404 });
    }
  } else if (!/^\/fallbackfont\b/i.test(path)) {
    // Everything playback-related carries an item id and is access-checked
    // above. The only exception is the static fallback font libass needs.
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const playbackToken = readJellyfinToken(user);
  if (!playbackToken) {
    return NextResponse.json(
      { error: 'jellyfin_connect_required', message: 'Connect your Jellyfin account to watch.' },
      { status: 409 },
    );
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
  if (upstreamUrl.origin !== origin || !resolvedPathStillAllowed(upstreamUrl.pathname, basePath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Signed with the member's own token, not the admin key: this is the request
  // Jellyfin bills the stream against, so it decides whose session is playing.
  // It also means Jellyfin enforces that member's library permissions on the
  // bytes themselves, behind the canUserAccessItem check above.
  const headers = new Headers({
    ...getConnectionHeaders(connection),
    Authorization: `MediaBrowser Token="${playbackToken}"`,
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

  if (upstream.status === 401 || upstream.status === 403) {
    // Revoked upstream mid-stream. Drop the stored copy so the next request
    // gates cleanly instead of retrying a dead token segment after segment.
    await invalidateJellyfinToken(user.id).catch((error) =>
      console.error('[api] Failed to drop a revoked Jellyfin token:', error),
    );
    return NextResponse.json(
      { error: 'jellyfin_connect_required', message: 'Connect your Jellyfin account to watch.' },
      { status: 409 },
    );
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    return new NextResponse(null, { status: 404 });
  }

  const contentType = upstream.headers.get('content-type');
  if (request.method === 'GET' && isHlsPlaylist(path, contentType)) {
    const body = await upstream.text();
    const rewritten = rewriteHlsPlaylist(body, origin, path);
    if (itemId) {
      for (const playlistId of legacyHlsPlaylistIds(rewritten)) await bindHlsPlaylist(user.id, playlistId, itemId);
    }
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
