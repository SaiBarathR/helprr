import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { rebuildTasteProfile } from '@/lib/recommendations/profile-store';
import { invalidateRecommendations } from '@/lib/recommendations/engine';
import { upstreamErrorResponse } from '@/lib/api-error';

// Force a profile rebuild for the CALLING user only (used after linking
// Jellyfin/AniList so new powers apply without waiting for staleness).
async function postHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('recommendations.view');
  if (!auth.ok) return auth.response;

  try {
    const profile = await rebuildTasteProfile(auth.user);
    await invalidateRecommendations(auth.user.id);
    return NextResponse.json({ builtAt: profile.builtAt, sources: profile.sources });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to rebuild taste profile');
  }
}

export const POST = withApiLogging(postHandler, 'api/recommendations/rebuild');
