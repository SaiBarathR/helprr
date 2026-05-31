import type { User } from '@prisma/client';
import { prisma } from '@/lib/db';

/** Public-safe view of a user — never leaks passwordHash or jellyfinToken. */
export function toSafeUser(u: User) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    status: u.status,
    template: u.template,
    jellyfinUserId: u.jellyfinUserId,
    seerrUserId: u.seerrUserId,
    hasPassword: u.passwordHash !== null,
    hasJellyfinLink: u.jellyfinUserId !== null,
    createdAt: u.createdAt,
  };
}

/**
 * Prisma `where` fragment that scopes a per-user resource to its owner: admins
 * see everything ({}), members are restricted to their own rows ({ userId }).
 * Spread into a where clause: `where: { ...ownerScope(user), revokedAt: null }`.
 */
export function ownerScope(user: Pick<User, 'role' | 'id'>): { userId?: string } {
  return user.role === 'admin' ? {} : { userId: user.id };
}

/** Count active admins, optionally excluding one user id (for last-admin guards). */
export async function countActiveAdmins(excludeId?: string): Promise<number> {
  return prisma.user.count({
    where: {
      role: 'admin',
      status: 'active',
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
  });
}
