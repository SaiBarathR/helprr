import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export async function POST() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    await prisma.notificationHistory.updateMany({
      where: { read: false },
      data: { read: true },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
