import type { Prisma, PrismaClient } from '@prisma/client';

const LOCK_TIMEOUT_MS = 60_000;

/**
 * The lock every request for this file takes when it queues a job. Anything that changes a
 * file holds it, reads the row again inside, and so acts on what is true now rather than on
 * what was true when the work was picked up.
 */
export function withFileLock<T>(
  prisma: PrismaClient,
  fileId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`twitch-delete:${fileId}`}))`;
    return work(tx);
  }, { maxWait: LOCK_TIMEOUT_MS, timeout: LOCK_TIMEOUT_MS });
}
