import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { prisma } from '@/lib/db';
import { readServiceBadgeCounts } from '@/lib/cache/badge-counts';
import { ownerScope } from '@/lib/user-dto';
import { withApiLogging } from '@/lib/api-logger';
import { EMPTY_BADGE_SLICE, type BadgeCounts } from '@/types/badges';

// Aggregated nav badge counts for the signed-in user. Reads service counts the
// background poll already stashed in Redis (zero upstream load) and computes the
// per-user unread notification count from the DB. Each area is gated by the same
// capability that gates its nav item, so a member never receives a count for an
// area they can't see.
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const [service, unread] = await Promise.all([
    readServiceBadgeCounts(),
    can(user, 'notifications.view')
      ? prisma.notificationHistory.count({
          where: {
            read: false,
            // Same scoping the read/delete routes use (members → own; admins →
            // everything incl. null-owner global), so the badge always matches
            // exactly what mark-read / mark-all-read clear.
            ...ownerScope(user),
          },
        })
      : Promise.resolve(0),
  ]);

  const counts: BadgeCounts = {
    activity: can(user, 'activity.view') ? service.activity : { ...EMPTY_BADGE_SLICE },
    downloads: can(user, 'torrents.view') ? service.downloads : { ...EMPTY_BADGE_SLICE },
    // Pending approvals are an approver metric.
    requests: can(user, 'requests.approve') ? service.requests : { ...EMPTY_BADGE_SLICE },
    notifications: { total: unread, attention: unread },
  };

  return NextResponse.json(counts);
}

export const GET = withApiLogging(getHandler, 'api/badges');
