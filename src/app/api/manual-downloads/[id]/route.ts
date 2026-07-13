import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { withApiLogging } from '@/lib/api-logger';

async function deleteHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserCapability('torrents.manage');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  await prisma.manualDownloadMapping.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ success: true });
}

export const DELETE = withApiLogging(deleteHandler, 'api/manual-downloads/[id]');
