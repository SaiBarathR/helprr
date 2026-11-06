import type { Prisma, User } from '@prisma/client';

/**
 * Serialize every change that can remove an active admin (a delete, a demotion,
 * a disable) for the rest of the caller's transaction. Without it, two such
 * changes to different admins each count the other as remaining and both
 * commit, leaving none.
 */
export async function lockActiveAdminGuard(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('helprr:last-active-admin'))`;
}

/**
 * Delete one user inside the caller's transaction, unless they are the last
 * active admin. Returns false (and deletes nothing) for the last active admin.
 * The admin count is re-checked under the guard lock in the same transaction
 * as the delete, so concurrent requests can't race it and leave no active admin.
 *
 * Shared by Settings -> Users (an admin deleting someone) and Settings ->
 * Account (a user deleting themselves), so both cascade the same way.
 */
export async function deleteUserUnlessLastAdmin(
  tx: Prisma.TransactionClient,
  user: Pick<User, 'id' | 'role' | 'status'>,
): Promise<boolean> {
  if (user.role === 'admin' && user.status === 'active') {
    await lockActiveAdminGuard(tx);
    const remaining = await tx.user.count({
      where: { role: 'admin', status: 'active', NOT: { id: user.id } },
    });
    if (remaining === 0) return false;
  }
  // Cascade (schema onDelete: Cascade) drops their sessions, watchlist, push
  // subscriptions, AniList link, and settings with them.
  await tx.user.delete({ where: { id: user.id } });
  return true;
}
