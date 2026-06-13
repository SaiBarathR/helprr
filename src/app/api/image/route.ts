import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { fetchImageWithServerCache } from '@/lib/cache/image-cache';
import { withApiLogging } from '@/lib/api-logger';

type ServiceHint = 'tmdb' | 'radarr' | 'sonarr' | 'jellyfin' | 'anilist' | 'lidarr';

interface ConnectionLike {
  type: 'RADARR' | 'SONARR' | 'JELLYFIN' | 'TMDB' | 'LIDARR';
  url: string;
  apiKey: string;
}

const IMAGE_PATH_EXTENSION_RE = /\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|webp)$/i;

const SERVICE_IMAGE_PATH_PATTERNS: Record<ConnectionLike['type'], RegExp[]> = {
  RADARR: [/^\/(?:api\/v\d+\/)?mediacover\//i],
  SONARR: [/^\/(?:api\/v\d+\/)?mediacover\//i],
  LIDARR: [/^\/(?:api\/v\d+\/)?mediacover\//i],
  JELLYFIN: [/^\/items\/[^/]+\/images\/[^/]+(?:\/\d+)?$/i],
  TMDB: [/^\/t\/p\//i],
};

type ImageProxyConnectionRow = Pick<ConnectionLike, 'type'> & { url: string; apiKey: string };

// The proxy resolves auth headers from connection rows on every image request.
// Connections change only when an admin edits a service in Settings and Helprr
// is single-instance, so an in-memory cache (with in-flight dedupe) collapses a
// cold dashboard load of N posters into a single DB query. Worst-case staleness
// after editing a service is one TTL window of a stale auth header — harmless,
// since image URLs keep their identity and only the token would briefly lag.
const CONNECTIONS_CACHE_TTL_MS = 30_000;
let connectionsCache: { at: number; rows: ImageProxyConnectionRow[] } | null = null;
let connectionsInflight: Promise<ImageProxyConnectionRow[]> | null = null;

async function getImageProxyConnections(): Promise<ImageProxyConnectionRow[]> {
  const now = Date.now();
  if (connectionsCache && now - connectionsCache.at < CONNECTIONS_CACHE_TTL_MS) {
    return connectionsCache.rows;
  }
  if (connectionsInflight) return connectionsInflight;

  connectionsInflight = prisma.serviceConnection
    .findMany({
      where: { type: { in: ['RADARR', 'SONARR', 'JELLYFIN', 'TMDB', 'LIDARR'] } },
      select: { type: true, url: true, apiKey: true },
    })
    .then((rows) => {
      connectionsCache = { at: Date.now(), rows: rows as ImageProxyConnectionRow[] };
      return connectionsCache.rows;
    })
    .finally(() => {
      connectionsInflight = null;
    });

  return connectionsInflight;
}

function parseServiceHint(value: string | null): ServiceHint | null {
  if (value === 'tmdb' || value === 'radarr' || value === 'sonarr' || value === 'jellyfin' || value === 'anilist' || value === 'lidarr') {
    return value;
  }
  return null;
}

// Display width for the WebP transform. Call sites opt in via `&w=`; absent or
// invalid values fall back to a server-side cap so every proxied image still
// shrinks. Clamped to a sane max to bound transcode cost.
const DEFAULT_IMAGE_WIDTH = 600;
const MAX_IMAGE_WIDTH = 2000;

function parseWidthParam(value: string | null): number {
  if (value === null) return DEFAULT_IMAGE_WIDTH;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_IMAGE_WIDTH;
  return Math.min(parsed, MAX_IMAGE_WIDTH);
}

const DEFAULT_EXTERNAL_IMAGE_HOSTS = new Set<string>([
  'image.tmdb.org',
  'artworks.thetvdb.com',
  'thetvdb.com',
  'www.thetvdb.com',
  'fanart.tv',
  'assets.fanart.tv',
  'static.tvmaze.com',
  's4.anilist.co',
  's1.anilist.co',
  's2.anilist.co',
  's3.anilist.co',
  'images.lidarr.audio',
]);

function getAllowedExternalImageHosts(): Set<string> {
  const hosts = new Set(DEFAULT_EXTERNAL_IMAGE_HOSTS);
  const extra = process.env.EXTRA_ALLOWED_IMAGE_HOSTS;
  if (!extra) return hosts;

  for (const rawHost of extra.split(',')) {
    const host = rawHost.trim().toLowerCase();
    if (!host) continue;
    hosts.add(host);
  }
  return hosts;
}

function isExplicitlyPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost') return true;
  if (host.endsWith('.local')) return true;
  if (host === '0.0.0.0' || host === '::1') return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  return false;
}

function isAllowedKnownExternalImageHost(target: URL): boolean {
  if (isExplicitlyPrivateHost(target.hostname)) return false;
  const allowedHosts = getAllowedExternalImageHosts();
  return allowedHosts.has(target.hostname.toLowerCase());
}

function normalizeBaseUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed;
  } catch {
    return null;
  }
}

function matchesConnectionBase(target: URL, base: URL): boolean {
  if (target.protocol !== base.protocol || target.host !== base.host) {
    return false;
  }

  const basePath = base.pathname.replace(/\/+$/, '');
  if (!basePath || basePath === '/') {
    return true;
  }

  return target.pathname === basePath || target.pathname.startsWith(`${basePath}/`);
}

function getPathRelativeToBase(target: URL, base: URL): string | null {
  const basePath = base.pathname.replace(/\/+$/, '');
  if (!basePath || basePath === '/') return target.pathname;
  if (target.pathname === basePath) return '/';
  if (target.pathname.startsWith(`${basePath}/`)) {
    return target.pathname.slice(basePath.length) || '/';
  }
  return null;
}

function isMatchedConnectionImagePathAllowed(connection: ConnectionLike, target: URL): boolean {
  const base = normalizeBaseUrl(connection.url);
  if (!base) return false;
  const relativePath = getPathRelativeToBase(target, base);
  if (!relativePath) return false;

  if (IMAGE_PATH_EXTENSION_RE.test(relativePath)) {
    return true;
  }

  const patterns = SERVICE_IMAGE_PATH_PATTERNS[connection.type];
  return patterns.some((pattern) => pattern.test(relativePath));
}

function resolveAuthHeaders(connection: ConnectionLike | null): HeadersInit | undefined {
  if (!connection) return undefined;

  if (connection.type === 'RADARR' || connection.type === 'SONARR' || connection.type === 'LIDARR') {
    return {
      'X-Api-Key': connection.apiKey,
    };
  }

  if (connection.type === 'JELLYFIN') {
    return {
      Authorization: `MediaBrowser Token="${connection.apiKey}"`,
      'X-Emby-Token': connection.apiKey,
    };
  }

  return undefined;
}

function sortConnectionsByHint(connections: ConnectionLike[], hint: ServiceHint | null): ConnectionLike[] {
  if (!hint || hint === 'tmdb') return connections;

  const preferredType = hint.toUpperCase() as ConnectionLike['type'];
  return [...connections].sort((a, b) => {
    const aPreferred = a.type === preferredType ? 1 : 0;
    const bPreferred = b.type === preferredType ? 1 : 0;
    return bPreferred - aPreferred;
  });
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const src = searchParams.get('src');
    const hint = parseServiceHint(searchParams.get('service'));
    const width = parseWidthParam(searchParams.get('w'));

    if (!src) {
      return NextResponse.json({ error: 'Missing src parameter' }, { status: 400 });
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(src);
    } catch {
      return NextResponse.json({ error: 'Invalid src URL' }, { status: 400 });
    }

    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return NextResponse.json({ error: 'Unsupported image protocol' }, { status: 400 });
    }

    const isTmdbImageHost = targetUrl.hostname === 'image.tmdb.org';

    const connectionsRaw = await getImageProxyConnections();

    const connections: ConnectionLike[] = connectionsRaw
      .map((conn) => {
        const parsed = normalizeBaseUrl(conn.url);
        if (!parsed) return null;
        return {
          type: conn.type as ConnectionLike['type'],
          url: parsed.toString(),
          apiKey: conn.apiKey,
        };
      })
      .filter((value): value is ConnectionLike => Boolean(value));

    const orderedConnections = sortConnectionsByHint(connections, hint);
    const matchedConnection = orderedConnections.find((connection) => {
      const base = normalizeBaseUrl(connection.url);
      return base ? matchesConnectionBase(targetUrl, base) : false;
    }) || null;
    const matchedConnectionPathAllowed = matchedConnection
      ? isMatchedConnectionImagePathAllowed(matchedConnection, targetUrl)
      : false;

    if (matchedConnection && !matchedConnectionPathAllowed) {
      return NextResponse.json({ error: 'Image source path is not allowed' }, { status: 403 });
    }

    const allowed = isTmdbImageHost
      || matchedConnectionPathAllowed
      || isAllowedKnownExternalImageHost(targetUrl);
    if (!allowed) {
      return NextResponse.json({ error: 'Image source host is not allowed' }, { status: 403 });
    }

    const upstreamHeaders = matchedConnectionPathAllowed
      ? resolveAuthHeaders(matchedConnection)
      : undefined;

    const baseCacheKey = `${hint ?? matchedConnection?.type.toLowerCase() ?? 'unknown'}:${targetUrl.toString()}`;
    const result = await fetchImageWithServerCache({
      cacheKey: `${baseCacheKey}:w${width}:webp`,
      upstreamUrl: targetUrl.toString(),
      upstreamHeaders,
      transform: { width },
    });

    if (!result.body) {
      return new NextResponse(null, {
        status: result.status,
        headers: {
          'X-Helprr-Cache': result.cacheStatus,
        },
      });
    }

    return new NextResponse(new Uint8Array(result.body), {
      status: 200,
      headers: {
        'Content-Type': result.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=86400, stale-while-revalidate=604800, stale-if-error=2592000',
        'X-Helprr-Cache': result.cacheStatus,
      },
    });
  } catch (error) {
    console.error('Failed to proxy image', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: 'Failed to proxy image' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/image');
