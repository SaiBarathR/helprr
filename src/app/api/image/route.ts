import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { fetchImageWithServerCache } from '@/lib/cache/image-cache';

type ServiceHint = 'tmdb' | 'radarr' | 'sonarr' | 'jellyfin';

interface ConnectionLike {
  type: 'RADARR' | 'SONARR' | 'JELLYFIN' | 'TMDB';
  url: string;
  apiKey: string;
}

const IMAGE_PATH_EXTENSION_RE = /\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|webp)$/i;

const SERVICE_IMAGE_PATH_PATTERNS: Record<ConnectionLike['type'], RegExp[]> = {
  RADARR: [/^\/(?:api\/v\d+\/)?mediacover\//i],
  SONARR: [/^\/(?:api\/v\d+\/)?mediacover\//i],
  JELLYFIN: [/^\/items\/[^/]+\/images\/[^/]+(?:\/\d+)?$/i],
  TMDB: [/^\/t\/p\//i],
};

function parseServiceHint(value: string | null): ServiceHint | null {
  if (value === 'tmdb' || value === 'radarr' || value === 'sonarr' || value === 'jellyfin') {
    return value;
  }
  return null;
}

const DEFAULT_EXTERNAL_IMAGE_HOSTS = new Set<string>([
  'image.tmdb.org',
  'artworks.thetvdb.com',
  'thetvdb.com',
  'www.thetvdb.com',
  'fanart.tv',
  'assets.fanart.tv',
  'static.tvmaze.com',
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

function isAllowedExternalHostForArr(hint: ServiceHint | null, target: URL): boolean {
  if (hint !== 'sonarr' && hint !== 'radarr') return false;
  if (isExplicitlyPrivateHost(target.hostname)) return false;
  const allowedHosts = getAllowedExternalImageHosts();
  return allowedHosts.has(target.hostname.toLowerCase());
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

  if (connection.type === 'RADARR' || connection.type === 'SONARR') {
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const src = searchParams.get('src');
    const hint = parseServiceHint(searchParams.get('service'));

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

    const connectionsRaw = await prisma.serviceConnection.findMany({
      where: {
        type: {
          in: ['RADARR', 'SONARR', 'JELLYFIN', 'TMDB'],
        },
      },
      select: {
        type: true,
        url: true,
        apiKey: true,
      },
    });

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
      || isAllowedExternalHostForArr(hint, targetUrl)
      || isAllowedKnownExternalImageHost(targetUrl);
    if (!allowed) {
      return NextResponse.json({ error: 'Image source host is not allowed' }, { status: 403 });
    }

    const upstreamHeaders = matchedConnectionPathAllowed
      ? resolveAuthHeaders(matchedConnection)
      : undefined;

    const result = await fetchImageWithServerCache({
      cacheKey: `${hint ?? matchedConnection?.type.toLowerCase() ?? 'unknown'}:${targetUrl.toString()}`,
      upstreamUrl: targetUrl.toString(),
      upstreamHeaders,
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
