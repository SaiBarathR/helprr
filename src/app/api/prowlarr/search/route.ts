import { NextRequest, NextResponse } from 'next/server';
import { isAxiosError } from 'axios';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { issueReleaseTokens } from '@/lib/prowlarr-release-tokens';
import { redactProwlarrText } from '@/lib/prowlarr-redact';
import type { ProwlarrRelease } from '@/lib/prowlarr-client';

const MAX_QUERY_LENGTH = 200;
const MAX_RESULTS = 100;
const ALLOWED_CATEGORIES = new Set([2000, 3000, 5000, 7000]);

export interface ProwlarrSearchResult {
  id: string;
  title: string;
  size: number;
  seeders: number | null;
  leechers: number | null;
  publishDate: string | null;
  indexer: string;
  protocol: string;
}

/**
 * Search every indexer. A search hits private trackers too, so it needs
 * prowlarr.manage, not view. Only display fields leave the server: a release's
 * guid, download, magnet and info links can all carry a passkey or Prowlarr's
 * own key, so the browser gets a token in place of the guid.
 */
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('prowlarr.manage');
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const query = (params.get('q') ?? '').trim();
  if (query.length < 2 || query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json({ error: `Search for 2 to ${MAX_QUERY_LENGTH} characters` }, { status: 400 });
  }
  const categories = (params.get('categories') ?? '').split(',').filter(Boolean).map(Number);
  if (!categories.every((category) => ALLOWED_CATEGORIES.has(category))) {
    return NextResponse.json({ error: 'Unknown category' }, { status: 400 });
  }

  try {
    const client = await getProwlarrClient();
    const found = await client.searchReleases({ query, categories }, request.signal);
    const releases = (Array.isArray(found) ? found : [])
      .filter((release): release is ProwlarrRelease => Boolean(release?.guid && release.title && release.indexerId))
      .sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0))
      .slice(0, MAX_RESULTS);
    const tokens = await issueReleaseTokens(
      auth.user.id,
      releases.map(({ guid, indexerId }) => ({ guid, indexerId })),
    );
    const results: ProwlarrSearchResult[] = releases.map((release, index) => ({
      id: tokens[index],
      title: redactProwlarrText(release.title),
      size: release.size ?? 0,
      seeders: release.seeders ?? null,
      leechers: release.leechers ?? null,
      publishDate: release.publishDate ?? null,
      indexer: redactProwlarrText(release.indexer ?? ''),
      protocol: release.protocol ?? '',
    }));
    return NextResponse.json({ results });
  } catch (error) {
    if (isAxiosError(error) && error.code === 'ERR_CANCELED') return new NextResponse(null, { status: 499 });
    return upstreamErrorResponse(error, 'Search failed');
  }
}

// A search can be for a pasted URL with a key in it.
export const GET = withApiLogging(getHandler, 'api/prowlarr/search', { redactQueryParams: ['q'] });
