import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * DELETE /api/scheduled-alerts/[id]: cancels an active alert; with
 * ?permanent=true, removes a cancelled one for good. Both only for its owner.
 */

type Alert = { id: string; userId: string; status: string };

const mocks = vi.hoisted(() => ({
  user: { id: 'owner', role: 'member' } as { id: string; role: string },
  allowed: true,
  alerts: [] as Alert[],
  deleteMany: vi.fn(),
  update: vi.fn(),
  occUpdateMany: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireUserCapability: vi.fn(async () => mocks.allowed
    ? { ok: true, user: mocks.user }
    : { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }),
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: vi.fn(async (ops: unknown[]) => ops),
    scheduledAlert: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) =>
        mocks.alerts.find((a) => a.id === where.id && a.userId === where.userId) ?? null),
      deleteMany: mocks.deleteMany,
      update: mocks.update,
    },
    scheduledAlertOccurrence: { updateMany: mocks.occUpdateMany },
  },
}));

const { DELETE } = await import('@/app/api/scheduled-alerts/[id]/route');
const del = DELETE as unknown as (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

function remove(id: string, permanent: boolean) {
  const url = `http://localhost/api/scheduled-alerts/${id}${permanent ? '?permanent=true' : ''}`;
  return del(new NextRequest(url, { method: 'DELETE' }), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 'owner', role: 'member' };
  mocks.allowed = true;
  mocks.alerts = [
    { id: 'cancelled-1', userId: 'owner', status: 'cancelled' },
    { id: 'active-1', userId: 'owner', status: 'active' },
    { id: 'other-1', userId: 'someone-else', status: 'cancelled' },
  ];
  mocks.deleteMany.mockResolvedValue({ count: 1 });
});

describe('deleting a cancelled scheduled alert', () => {
  it('lets its owner delete it, scoped to owner and status', async () => {
    const res = await remove('cancelled-1', true);
    expect(res.status).toBe(200);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: 'cancelled-1', userId: 'owner', status: 'cancelled' } });
  });

  it("never deletes another user's alert", async () => {
    expect((await remove('other-1', true)).status).toBe(404);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses an active alert, which must be cancelled first', async () => {
    expect((await remove('active-1', true)).status).toBe(409);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses without scheduledAlerts.edit', async () => {
    mocks.allowed = false;
    expect((await remove('cancelled-1', true)).status).toBe(403);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it('answers 404 when it changed since the read', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    expect((await remove('cancelled-1', true)).status).toBe(404);
  });

  it('without ?permanent, still only cancels', async () => {
    expect((await remove('active-1', false)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) }));
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});
