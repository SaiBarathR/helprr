import { NextRequest } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { arrHealthResponse } from '@/lib/server/arr-health-route';

// One instance's health checks. Gated like the health push (notify.health,
// admins always): the messages name hosts, paths and download clients.
async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('notify.health');
  if (!auth.ok) return auth.response;
  return arrHealthResponse('SONARR', request);
}

export const GET = withApiLogging(getHandler, 'api/sonarr/health');
