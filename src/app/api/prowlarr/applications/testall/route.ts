import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { redactProwlarrTestAll } from '@/lib/prowlarr-redact';

async function postHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('prowlarr.manage');
  if (!auth.ok) return auth.response;

  try {
    const client = await getProwlarrClient();
    return NextResponse.json(redactProwlarrTestAll(await client.testAllApplications()));
  } catch (error) {
    return upstreamErrorResponse(error, 'Test All failed');
  }
}

export const POST = withApiLogging(postHandler, 'api/prowlarr/applications/testall');
