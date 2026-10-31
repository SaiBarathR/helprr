import { Prisma, type PrismaClient, type TwitchJob, type TwitchJobKind } from '@prisma/client';

export const LEASE_MS = 60_000;

/** One atomic claim: SKIP LOCKED keeps two workers off one job, and an expired lease is taken over. */
export async function claimJob(
  prisma: PrismaClient,
  workerId: string,
  kinds: TwitchJobKind[],
  minPriority?: number,
): Promise<TwitchJob | null> {
  // Cancelled, then its worker died: nothing is left to acknowledge the cancel, so it ends here.
  await prisma.twitchJob.updateMany({
    where: { state: 'RUNNING', cancelRequested: true, leaseUntil: { lt: new Date() } },
    data: { state: 'CANCELLED', stage: 'cancelled', finishedAt: new Date(), leaseOwner: null, leaseUntil: null },
  });

  const rows = await prisma.$queryRaw<TwitchJob[]>`
    UPDATE "TwitchJob" SET
      "state" = 'RUNNING',
      "leaseOwner" = ${workerId},
      "leaseUntil" = NOW() + (${LEASE_MS} * INTERVAL '1 millisecond'),
      "attempts" = "attempts" + 1,
      "startedAt" = COALESCE("startedAt", NOW()),
      "updatedAt" = NOW()
    WHERE "id" = (
      SELECT "id" FROM "TwitchJob"
      WHERE "kind"::text IN (${Prisma.join(kinds)})
        AND "cancelRequested" = false
        ${minPriority === undefined ? Prisma.empty : Prisma.sql`AND "priority" >= ${minPriority}`}
        AND (
          ("state" IN ('QUEUED', 'RETRY_WAIT', 'BLOCKED') AND "runAfter" <= NOW())
          OR ("state" = 'RUNNING' AND "leaseUntil" < NOW())
        )
      ORDER BY "priority" DESC, "runAfter" ASC, "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;
  return rows[0] ?? null;
}
