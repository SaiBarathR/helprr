import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// When scripts/backup.sh last made and validated a database dump (it records the
// time itself; the app never runs a backup). Admin-only, like the backups.
async function getHandler(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const settings = await prisma.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { lastDatabaseBackupAt: true },
  });
  return NextResponse.json(
    { lastBackupAt: settings?.lastDatabaseBackupAt?.toISOString() ?? null },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export const GET = withApiLogging(getHandler, 'api/admin/database-backup', { logBodies: false });
