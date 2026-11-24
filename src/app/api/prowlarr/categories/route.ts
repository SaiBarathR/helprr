import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserAnyCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { getProwlarrCategoryTree } from '@/lib/prowlarr-categories';

/** Prowlarr's category tree, for the search options: ids and names only. */
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserAnyCapability(['prowlarr.search', 'prowlarr.manage']);
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json(await getProwlarrCategoryTree(await getProwlarrClient()));
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch categories');
  }
}

export const GET = withApiLogging(getHandler, 'api/prowlarr/categories');
