import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

const MY_DATA_EXPORT_KIND = 'helprr-my-data';
const MY_DATA_EXPORT_VERSION = 1;

/**
 * "Download my data": the signed-in user's own records, as one JSON file:
 * profile, settings, linked-account names, watchlist, alerts, layouts, push
 * devices and their rules, notification history, pending requests, sessions
 * and follows. Recommendation signals and per-video seen/hidden flags are left
 * out (see the coverage test). The user comes from the session only, and every query is scoped
 * to that user id and names its columns, so the file never holds another
 * user's rows or a secret: no password hash, Jellyfin/AniList/Twitch token,
 * push endpoint or key, or session id. Not a backup: there is no import for it.
 */
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, session } = auth;
  const userId = user.id;

  try {
    const [
      settings,
      aniList,
      twitch,
      watchlistItems,
      watchlistTags,
      scheduledAlerts,
      dashboardLayouts,
      devices,
      notificationHistory,
      requests,
      sessions,
      creatorSubscriptions,
      playlistSubscriptions,
    ] = await Promise.all([
      prisma.userSettings.findUnique({
        where: { userId },
        select: {
          timeZone: true,
          upcomingNotifyMode: true,
          activityDigestMode: true,
          defaultDesktopLayoutId: true,
          defaultMobileLayoutId: true,
          quietHoursEnabled: true,
          quietHoursStart: true,
          quietHoursEnd: true,
          setupChecklistDismissedAt: true,
          setupStepsDone: true,
          lastSeenVersion: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.userAniListLink.findUnique({
        where: { userId },
        select: { anilistUserId: true, username: true, avatar: true, siteUrl: true, scoreFormat: true, createdAt: true },
      }),
      prisma.twitchUserLink.findUnique({
        where: { userId },
        select: { twitchUserId: true, login: true, createdAt: true },
      }),
      prisma.watchlistItem.findMany({
        where: { userId },
        select: {
          source: true,
          externalId: true,
          mediaType: true,
          title: true,
          year: true,
          posterUrl: true,
          overview: true,
          rating: true,
          addedAt: true,
          reminderAt: true,
          reminderNotifiedAt: true,
          tags: { select: { name: true } },
        },
        orderBy: { addedAt: 'asc' },
      }),
      prisma.watchlistTag.findMany({
        where: { userId },
        select: { name: true, color: true },
        orderBy: { name: 'asc' },
      }),
      prisma.scheduledAlert.findMany({
        where: { userId },
        select: {
          source: true,
          externalId: true,
          mediaType: true,
          instanceId: true,
          title: true,
          subtitle: true,
          href: true,
          scheduleMode: true,
          scope: true,
          releaseTypes: true,
          offsetMinutes: true,
          timeZone: true,
          status: true,
          createdAt: true,
          cancelledAt: true,
          occurrences: {
            select: { releaseKind: true, releaseAt: true, notifyAt: true, title: true, status: true, sentAt: true },
            orderBy: { notifyAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.dashboardLayout.findMany({
        where: { userId },
        select: { id: true, name: true, widgets: true, createdAt: true, updatedAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      // The device name, dates and rules only: the endpoint and keys can send to the device.
      prisma.pushSubscription.findMany({
        where: { userId },
        select: {
          deviceName: true,
          createdAt: true,
          lastSucceededAt: true,
          revokedAt: true,
          preferences: {
            select: { eventType: true, enabled: true, tagFilter: true, qualityFilter: true, mutedUserFilter: true },
            orderBy: { eventType: 'asc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      // Rows stamped with this user only. An admin's list also shows install-wide
      // rows (no owner), which are not theirs to take.
      prisma.notificationHistory.findMany({
        where: { userId },
        select: { eventType: true, title: true, body: true, metadata: true, read: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.pendingRequest.findMany({
        where: { userId },
        select: { mediaType: true, tmdbId: true, title: true, posterUrl: true, is4k: true, seasons: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      // The id only marks this session as current; it is not written to the file.
      prisma.session.findMany({
        where: { userId },
        select: { id: true, label: true, userAgent: true, ip: true, createdAt: true, lastSeenAt: true, revokedAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.creatorSubscription.findMany({
        where: { userId },
        select: {
          notifyNewVods: true,
          createdAt: true,
          creator: { select: { platform: true, externalId: true, login: true, displayName: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.creatorPlaylistSubscription.findMany({
        where: { userId },
        select: {
          notifyNewVideos: true,
          createdAt: true,
          playlist: { select: { platform: true, externalId: true, title: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const payload = {
      kind: MY_DATA_EXPORT_KIND,
      version: MY_DATA_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      profile: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        status: user.status,
        template: user.template,
        permissions: user.permissions,
        hasLocalPassword: Boolean(user.passwordHash),
        jellyfinUserId: user.jellyfinUserId,
        seerrUserId: user.seerrUserId,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      settings,
      linkedAccounts: { aniList, twitch },
      watchlist: {
        items: watchlistItems.map(({ tags, ...item }) => ({ ...item, tags: tags.map((t) => t.name) })),
        tags: watchlistTags,
      },
      scheduledAlerts,
      dashboardLayouts,
      notificationDevices: devices,
      notificationHistory,
      // Requests still waiting for an admin in Helprr. Approved ones live in Seerr.
      pendingRequests: requests,
      sessions: sessions.map(({ id, ...row }) => ({ ...row, current: id === session.id })),
      follows: {
        creators: creatorSubscriptions,
        playlists: playlistSubscriptions,
      },
    };

    const date = new Date().toISOString().slice(0, 10);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="helprr-my-data-${date}.json"`,
      },
    });
  } catch (error) {
    // Name and code only: a Prisma message can echo the arguments.
    const code = (error as { code?: unknown } | null)?.code;
    const reason = error instanceof Error
      ? `${error.name}${typeof code === 'string' ? ` ${code}` : ''}`
      : 'unknown error';
    console.error(`[MyData] Export failed for user ${userId}: ${reason}`);
    return NextResponse.json({ error: 'Failed to build your data export' }, { status: 500 });
  }
}

// Bodies stay out of the API log: the response is the user's whole data.
export const GET = withApiLogging(getHandler, 'api/me/export', { logBodies: false });
