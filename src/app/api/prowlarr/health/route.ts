import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { redactProwlarrText } from '@/lib/prowlarr-redact';
import type { HealthCheck } from '@/types/arr';

/**
 * Prowlarr's own health checks: failing indexers, apps that fail to sync, a
 * proxy that is down. Messages are redacted like other Prowlarr text, and only
 * https help links are passed on.
 */
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('prowlarr.view');
  if (!auth.ok) return auth.response;

  try {
    const client = await getProwlarrClient();
    const checks = await client.getHealth();
    const health: HealthCheck[] = (Array.isArray(checks) ? checks : []).map((check) => ({
      source: String(check.source ?? ''),
      type: String(check.type ?? ''),
      message: redactProwlarrText(String(check.message ?? '')),
      wikiUrl: typeof check.wikiUrl === 'string' && check.wikiUrl.startsWith('https://') ? check.wikiUrl : '',
    }));
    return NextResponse.json(health);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch Prowlarr health');
  }
}

export const GET = withApiLogging(getHandler, 'api/prowlarr/health');
