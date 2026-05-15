import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getSchedulerStatus } from '@/lib/cleanup/scheduler';

async function getHandler() {
  const err = await requireAuth();
  if (err) return err;
  return NextResponse.json(getSchedulerStatus());
}

export const GET = withApiLogging(getHandler, 'api/cleanup/scheduler-status');
