import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getRecommendationRails } from '@/lib/recommendations/engine';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('recommendations.view');
  if (!auth.ok) return auth.response;

  try {
    const payload = await getRecommendationRails(auth.user);
    return NextResponse.json(payload);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to build recommendations');
  }
}

export const GET = withApiLogging(getHandler, 'api/recommendations');
