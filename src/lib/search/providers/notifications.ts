import { prisma } from '@/lib/db';
import { matchLocalQueryAny } from '@/lib/search/providers/local-module';
import type { ProviderHandler } from '@/lib/search/providers/types';
import type { SearchProviderResult } from '@/lib/search/types';

export const searchNotifications: ProviderHandler = async ({ user, query, limit }) => {
  const where = {
    OR: [
      { title: { contains: query, mode: 'insensitive' as const } },
      { body: { contains: query, mode: 'insensitive' as const } },
    ],
    ...(user.role !== 'admin' ? { userId: user.id } : {}),
  };

  const records = await prisma.notificationHistory.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const results: SearchProviderResult[] = records.map((r) => ({
    id: `notification:${r.id}`,
    title: r.title,
    subtitle: r.body?.slice(0, 120) || undefined,
    year: null,
    poster: null,
    route: '/notifications',
    provider: 'notifications',
    badge: r.read ? undefined : 'Unread',
  }));

  return { results };
};

/** Client-side filter helper for in-memory notification-like rows. */
export function filterNotificationLike<T extends { title: string; body?: string | null }>(
  items: T[],
  query: string
): T[] {
  return items.filter((item) => matchLocalQueryAny(query, `${item.title} ${item.body ?? ''}`));
}
