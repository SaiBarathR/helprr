import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function deleteHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; occurrenceId: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('scheduledAlerts.edit');
  if (!auth.ok) return auth.response;

  const { id, occurrenceId } = await params;
  const occ = await prisma.scheduledAlertOccurrence.findFirst({
    where: {
      id: occurrenceId,
      alertId: id,
      status: 'pending',
      alert: { userId: auth.user.id },
    },
  });
  if (!occ) {
    const exists = await prisma.scheduledAlertOccurrence.findFirst({
      where: { id: occurrenceId, alertId: id, alert: { userId: auth.user.id } },
      select: { id: true },
    });
    if (exists) {
      return NextResponse.json({ error: 'Occurrence is no longer cancellable' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await prisma.scheduledAlertOccurrence.update({
    where: { id: occurrenceId },
    data: { status: 'cancelled', cancelledAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}

export const DELETE = withApiLogging(
  deleteHandler,
  'api/scheduled-alerts/[id]/occurrences/[occurrenceId]',
);
