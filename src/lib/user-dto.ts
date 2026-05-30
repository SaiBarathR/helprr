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
