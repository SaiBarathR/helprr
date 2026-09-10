import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getSchedulerStatus } from '@/lib/cleanup/scheduler';

async function getHandler() {
  const auth = await requireUserCapability('cleanup.view');
  if (!auth.ok) return auth.response;
  return NextResponse.json(getSchedulerStatus());
}

export const GET = withApiLogging(getHandler, 'api/cleanup/scheduler-status');
