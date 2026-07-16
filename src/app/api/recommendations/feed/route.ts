import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getRecommendationFeed } from '@/lib/recommendations/engine';
import { upstreamErrorResponse } from '@/lib/api-error';

const MAX_CURSOR_LENGTH = 64;

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('recommendations.view');
  if (!auth.ok) return auth.response;

  const raw = new URL(request.url).searchParams.get('cursor');
  const cursor = raw && raw.length <= MAX_CURSOR_LENGTH ? raw : null;

  try {
    const payload = await getRecommendationFeed(auth.user, cursor);
    return NextResponse.json(payload);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to build recommendation feed');
  }
}

export const GET = withApiLogging(getHandler, 'api/recommendations/feed');
