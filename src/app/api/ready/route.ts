import { NextResponse } from 'next/server';
import { assessReadiness } from '@/lib/readiness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const report = await assessReadiness();
  return NextResponse.json(report, {
    status: report.status === 'ready' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
