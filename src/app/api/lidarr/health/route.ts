import { NextRequest } from 'next/server';
import { requireUserAllCapabilities } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { arrHealthResponse } from '@/lib/server/arr-health-route';

// One instance's health checks. Gated like Lidarr's health push: notify.health
// (the messages name hosts and paths) and music.view (they can name an artist).
async function getHandler(request: NextRequest) {
  const auth = await requireUserAllCapabilities(['notify.health', 'music.view']);
  if (!auth.ok) return auth.response;
  return arrHealthResponse('LIDARR', request);
}

export const GET = withApiLogging(getHandler, 'api/lidarr/health');
