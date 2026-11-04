import { NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { needsFirstAdmin } from '@/lib/first-admin';

// Public: says only whether the first admin still has to be created.
async function getHandler(): Promise<NextResponse> {
  return NextResponse.json({ needsAdmin: await needsFirstAdmin() }, { headers: { 'Cache-Control': 'no-store' } });
}

export const GET = withApiLogging(getHandler, 'api/setup/state');
