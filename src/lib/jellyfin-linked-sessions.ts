import type { Prisma } from '@prisma/client';

/**
 * Sign out every account linked to a Jellyfin user, for when the Jellyfin
 * connection moves to another address: "Sign in with Jellyfin" signs in
 * whichever account is linked to the user the server vouches for, so a session
 * made through the old server must not outlive the switch. A session does not
 * record how it was made, so this ends every session of a linked account,
 * except `keepSessionId` (the admin making the change, who just confirmed
 * their password). The members' stored Jellyfin tokens are for the old server
 * and go too, so they are never sent to the new address. Counts are for the
 * audit row.
 */
export async function revokeJellyfinLinkedSessions(
  tx: Prisma.TransactionClient,
  keepSessionId: string | null,
): Promise<{ sessions: number; accounts: number }> {
  await tx.user.updateMany({ where: { jellyfinToken: { not: null } }, data: { jellyfinToken: null } });
  const where: Prisma.SessionWhereInput = {
    revokedAt: null,
    user: { jellyfinUserId: { not: null } },
    ...(keepSessionId ? { NOT: { id: keepSessionId } } : {}),
  };
  const accounts = await tx.session.findMany({ where, select: { userId: true }, distinct: ['userId'] });
  if (accounts.length === 0) return { sessions: 0, accounts: 0 };
  const revoked = await tx.session.updateMany({ where, data: { revokedAt: new Date() } });
  return { sessions: revoked.count, accounts: accounts.length };
}
