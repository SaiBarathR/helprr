import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

/**
 * Handle GET requests to fetch Prowlarr application profiles.
 *
 * Returns a JSON response containing the list of application profiles retrieved from the Prowlarr client.
 *
 * @returns A NextResponse with the application profiles as JSON, or a NextResponse with a JSON object `{ error: string }` and HTTP status 500 when retrieval fails.
 */
async function getHandler() {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('prowlarr.view');
  if (capError) return capError;

  try {
    const client = await getProwlarrClient();
    const profiles = await client.getAppProfiles();
    return NextResponse.json(profiles);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch app profiles');
  }
}

export const GET = withApiLogging(getHandler, 'api/prowlarr/appprofile');
