import { NextRequest, NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { describePasswordLink } from '@/lib/password-links';
import { invalidLinkResponse, readInviteRequest } from '@/lib/server/invite-request';

/**
 * Public: who a password link is for, so the page can greet them. POST so the
 * token stays out of query strings and request logs.
 */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const input = await readInviteRequest(request);
  if (!input.ok) return input.response;

  const link = await describePasswordLink(input.body.token);
  if (!link) return invalidLinkResponse(request);
  return NextResponse.json(link);
}

export const POST = withApiLogging(postHandler, 'api/invite/state', { logBodies: false });
