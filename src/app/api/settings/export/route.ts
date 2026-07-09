import { NextRequest, NextResponse } from 'next/server';
import type { ScheduledAlert, ScheduledAlertOccurrence, ServiceType, WatchlistItem, WatchlistTag } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAuth, requireCapability, getCurrentUser } from '@/lib/auth';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { parseDiskThresholds } from '@/lib/disk-space';
import { parseCustomHeaders } from '@/lib/service-connection-secrets';
import { withApiLogging } from '@/lib/api-logger';
import {
  type ExportedAnimeMapping,
  type ExportedAppSettings,
  type ExportedCleanup,
  type ExportedDashboardLayout,
  type ExportedDashboardLayouts,
  type ExportedNotificationDevice,
  type ExportedNotificationRule,
  type ExportedScheduledAlert,
  type ExportedServiceConnection,
  type ExportedUserAccount,
  type ExportedWatchlist,
  type ExportedWatchlistItem,
  type ExportedWatchlistTag,
  type SettingsExportPayload,
  EXPORT_FORMAT_KIND,
  EXPORT_FORMAT_VERSION,
  SERVICE_TYPES_EXPORTABLE,
} from '@/lib/settings-export';
import { EVENT_TYPES, type NotificationEventType } from '@/lib/notification-events';
import { STORE_VERSION } from '@/lib/store';
import { loadQueueCleanerConfig, loadStallRules, loadSlowRules } from '@/lib/cleanup/queue-cleaner';
import { loadDownloadCleanerConfig, loadSeedingRules } from '@/lib/cleanup/download-cleaner';

interface ExportRequestBody {
  appSettings?: boolean;
  discoverLayout?: boolean;
  services?: string[] | false;
  notificationPrefs?: boolean;
  cleanup?: boolean;
  dashboardLayouts?: boolean;
  watchlist?: boolean;
  scheduledAlerts?: boolean;
  animeMappings?: boolean;
  users?: boolean;
  includeSecrets?: boolean;
}

type WatchlistItemWithTags = WatchlistItem & { tags: { name: string }[] };

function mapWatchlistItems(items: WatchlistItemWithTags[]): ExportedWatchlistItem[] {
  return items.map((i) => ({
    source: i.source,
    externalId: i.externalId,
    mediaType: i.mediaType,
    title: i.title,
    year: i.year ?? null,
    posterUrl: i.posterUrl ?? null,
    overview: i.overview ?? null,
    rating: i.rating ?? null,
    addedAt: i.addedAt.toISOString(),
    reminderAt: i.reminderAt ? i.reminderAt.toISOString() : null,
    tags: i.tags.map((t) => t.name),
  }));
}

function mapWatchlistTags(tags: WatchlistTag[]): ExportedWatchlistTag[] {
  return tags.map((t) => ({ name: t.name, color: t.color ?? null }));
}

type ScheduledAlertWithPending = ScheduledAlert & { occurrences: ScheduledAlertOccurrence[] };

function toExportedScheduledAlert(alert: ScheduledAlertWithPending): ExportedScheduledAlert | null {
  const pending = alert.occurrences[0] ?? null;
  // An absolute alert whose single occurrence already fired is spent — there is
  // nothing left to restore on the other side.
  if (alert.scheduleMode === 'absolute' && !pending) return null;
  return {
    source: alert.source,
    externalId: alert.externalId,
    mediaType: alert.mediaType,
    instanceId: alert.instanceId ?? null,
    title: alert.title,
    subtitle: alert.subtitle ?? null,
    posterUrl: alert.posterUrl ?? null,
    href: alert.href ?? null,
    scheduleMode: alert.scheduleMode,
    scope: alert.scope,
    releaseTypes: Array.isArray(alert.releaseTypes)
      ? alert.releaseTypes.filter((t): t is string => typeof t === 'string')
      : [],
    offsetMinutes: alert.offsetMinutes,
    timeZone: alert.timeZone,
    metadata:
      alert.metadata && typeof alert.metadata === 'object' && !Array.isArray(alert.metadata)
        ? (alert.metadata as Record<string, unknown>)
        : null,
    absoluteNotifyAt:
      alert.scheduleMode === 'absolute' && pending ? pending.notifyAt.toISOString() : null,
  };
}

/** Active alert rules (with the earliest pending occurrence for absolute mode), grouped by owner. */
async function loadScheduledAlertsByUser(userId?: string): Promise<Map<string, ExportedScheduledAlert[]>> {
  const rows = await prisma.scheduledAlert.findMany({
    where: { status: 'active', ...(userId ? { userId } : {}) },
    include: {
      occurrences: { where: { status: 'pending' }, orderBy: { notifyAt: 'asc' }, take: 1 },
    },
    orderBy: { createdAt: 'asc' },
  });
  const byUser = new Map<string, ExportedScheduledAlert[]>();
  for (const row of rows) {
    const exported = toExportedScheduledAlert(row);
    if (!exported) continue;
    const list = byUser.get(row.userId) ?? [];
    list.push(exported);
    byUser.set(row.userId, list);
  }
  return byUser;
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('settings.backup');
  if (capError) return capError;

  let body: ExportRequestBody;
  try {
    body = (await request.json()) as ExportRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const includeSecrets = body.includeSecrets === true;
  const wantAppSettings = body.appSettings === true;
  const wantDiscoverLayout = body.discoverLayout === true;
  const wantNotificationPrefs = body.notificationPrefs === true;
  const wantCleanup = body.cleanup === true;
  const wantDashboardLayouts = body.dashboardLayouts === true;
  const wantWatchlist = body.watchlist === true;
  const wantScheduledAlerts = body.scheduledAlerts === true;
  const wantAnimeMappings = body.animeMappings === true;
  const wantUsers = body.users === true;
  const selectedServices: ServiceType[] = Array.isArray(body.services)
    ? (SERVICE_TYPES_EXPORTABLE.filter((t) => (body.services as string[]).includes(t)) as ServiceType[])
    : [];

  // Every section except the exporter's own watchlist and scheduled alerts is
  // global data — service connections (with secrets), every user account (with
  // password hashes when includeSecrets), app settings, all devices'
  // notification rules. The settings.backup capability alone must not expose
  // those to a member, so global sections require the admin role on top of it.
  const exporter = await getCurrentUser();
  if (!exporter) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const wantsGlobalData =
    includeSecrets ||
    wantAppSettings ||
    wantDiscoverLayout ||
    wantNotificationPrefs ||
    wantCleanup ||
    wantDashboardLayouts ||
    wantAnimeMappings ||
    wantUsers ||
    selectedServices.length > 0;
  if (exporter.role !== 'admin' && wantsGlobalData) {
    return NextResponse.json(
      { error: 'Only admins can export global settings, service connections, or user accounts' },
      { status: 403 }
    );
  }

  const payload: Omit<SettingsExportPayload, 'uiPrefs'> = {
    kind: EXPORT_FORMAT_KIND,
    version: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    zustandVersion: STORE_VERSION,
    includesSecrets: includeSecrets,
  };

  try {
    // Load AppSettings once if appSettings, discoverLayout, or dashboardLayouts
    // is requested (all live on the same singleton row — dashboardLayouts pulls
    // its default-layout IDs from here).
    const settings = wantAppSettings || wantDiscoverLayout || wantDashboardLayouts
      ? await getOrCreateAppSettings()
      : null;

    if (wantAppSettings && settings) {
      payload.appSettings = {
        pollingIntervalSecs: settings.pollingIntervalSecs,
        activityRefreshIntervalSecs: settings.activityRefreshIntervalSecs,
        torrentsRefreshIntervalSecs: settings.torrentsRefreshIntervalSecs,
        cacheImagesEnabled: settings.cacheImagesEnabled,
        timeZone: settings.timeZone,
        logEnabled: settings.logEnabled,
        logLevel: settings.logLevel,
        logMaxFileMb: settings.logMaxFileMb,
        logRetentionDays: settings.logRetentionDays,
        notificationHistoryRetentionDays: settings.notificationHistoryRetentionDays,
        logClientConsoleEnabled: settings.logClientConsoleEnabled,
        logFailedRequestBodies: settings.logFailedRequestBodies,
        logFailedResponseBodies: settings.logFailedResponseBodies,
        upcomingNotifyMode: settings.upcomingNotifyMode,
        upcomingNotifyBeforeMins: settings.upcomingNotifyBeforeMins,
        upcomingDailyNotifyHour: settings.upcomingDailyNotifyHour,
        watchProviderRegion: settings.watchProviderRegion,
        activityDigestMode: settings.activityDigestMode,
        activityDigestHour: settings.activityDigestHour,
        activityDigestDayOfWeek: settings.activityDigestDayOfWeek,
        notificationGroupingEnabled: settings.notificationGroupingEnabled,
        animeAutoMapEnabled: settings.animeAutoMapEnabled,
        animeAutoMapHour: settings.animeAutoMapHour,
        anilistSectionsTtlMin: settings.anilistSectionsTtlMin,
        anilistBrowseTtlMin: settings.anilistBrowseTtlMin,
        anilistDetailTtlMin: settings.anilistDetailTtlMin,
        anilistAiringTtlMin: settings.anilistAiringTtlMin,
        // Stored as-is; import re-normalizes via parseBandwidthSchedule().
        qbtBandwidthSchedule:
          (settings.qbtBandwidthSchedule ?? null) as unknown as ExportedAppSettings['qbtBandwidthSchedule'],
        diskThresholds: parseDiskThresholds(settings.diskThresholds),
      };
    }

    if (wantDiscoverLayout && settings?.discoverLayout) {
      payload.discoverLayout = settings.discoverLayout as Record<string, unknown>;
    }

    if (selectedServices.length > 0) {
      const connections = await prisma.serviceConnection.findMany({
        where: { type: { in: selectedServices } },
        orderBy: { type: 'asc' },
      });
      const exported: ExportedServiceConnection[] = connections.map((c) => {
        const headers = parseCustomHeaders(c.customHeaders);
        return {
          type: c.type,
          label: c.label,
          isDefault: c.isDefault,
          url: c.url,
          externalUrl: c.externalUrl ?? null,
          username: c.username ?? null,
          apiKey: includeSecrets ? c.apiKey : null,
          accessToken: includeSecrets ? (c.accessToken ?? null) : null,
          refreshToken: includeSecrets ? (c.refreshToken ?? null) : null,
          customHeaders: includeSecrets && Object.keys(headers).length > 0 ? headers : null,
        };
      });
      payload.serviceConnections = exported;
    }

    if (wantNotificationPrefs) {
      const rows = await prisma.notificationPreference.findMany({
        include: { subscription: { select: { id: true, deviceName: true } } },
        orderBy: [{ subscriptionId: 'asc' }, { eventType: 'asc' }],
      });
      const grouped = new Map<string, { deviceName: string; rules: ExportedNotificationRule[] }>();
      for (const row of rows) {
        if (!(EVENT_TYPES as readonly string[]).includes(row.eventType)) continue;
        const key = row.subscription.id;
        const deviceName = row.subscription.deviceName?.trim() || `Device ${key.slice(0, 6)}`;
        const entry = grouped.get(key) ?? { deviceName, rules: [] };
        entry.rules.push({
          eventType: row.eventType as NotificationEventType,
          enabled: row.enabled,
          tagFilter: row.tagFilter ?? null,
          qualityFilter: row.qualityFilter ?? null,
          mutedUserFilter: row.mutedUserFilter ?? null,
        });
        grouped.set(key, entry);
      }
      const devices: ExportedNotificationDevice[] = [];
      const seenNames = new Map<string, number>();
      for (const { deviceName, rules } of grouped.values()) {
        const count = (seenNames.get(deviceName) ?? 0) + 1;
        seenNames.set(deviceName, count);
        const uniqueName = count === 1 ? deviceName : `${deviceName} (${count})`;
        devices.push({ deviceName: uniqueName, rules });
      }
      payload.notificationPrefs = devices;
    }

    if (wantCleanup) {
      const [queueConfig, downloadConfig, stallRules, slowRules, seedingRules] = await Promise.all([
        loadQueueCleanerConfig(),
        loadDownloadCleanerConfig(),
        loadStallRules(),
        loadSlowRules(),
        loadSeedingRules(),
      ]);
      const cleanup: ExportedCleanup = {
        queueConfig,
        downloadConfig,
        stallRules,
        slowRules,
        seedingRules: seedingRules.filter((r) => !r.isSystem),
      };
      payload.cleanup = cleanup;
    }

    if (wantDashboardLayouts) {
      // Global (admin-scope) layouts only. Members' personal layouts are
      // exported per-account under the users section so they re-attach to
      // their owner instead of polluting the global list on import.
      const rows = await prisma.dashboardLayout.findMany({
        where: { userId: null },
        orderBy: { createdAt: 'asc' },
      });
      const layouts: ExportedDashboardLayout[] = rows.map((r) => ({
        name: r.name,
        isBuiltIn: r.isBuiltIn,
        slug: r.slug === 'desktop' || r.slug === 'mobile' ? r.slug : null,
        widgets: Array.isArray(r.widgets) ? (r.widgets as unknown[]) : [],
      }));
      const byId = new Map(rows.map((r) => [r.id, r.name] as const));
      const dashboardLayouts: ExportedDashboardLayouts = {
        layouts,
        defaultDesktopLayoutName: settings?.defaultDesktopLayoutId
          ? byId.get(settings.defaultDesktopLayoutId) ?? null
          : null,
        defaultMobileLayoutName: settings?.defaultMobileLayoutId
          ? byId.get(settings.defaultMobileLayoutId) ?? null
          : null,
      };
      payload.dashboardLayouts = dashboardLayouts;
    }

    if (wantWatchlist) {
      // Watchlist is per-user; back up the exporting user's own list. The
      // exporter was hard-resolved above, so `userId` can never collapse to
      // undefined and dump every user's watchlist.
      const [items, tags] = await Promise.all([
        prisma.watchlistItem.findMany({
          where: { userId: exporter.id },
          include: { tags: { select: { name: true } } },
          orderBy: { addedAt: 'asc' },
        }),
        prisma.watchlistTag.findMany({ where: { userId: exporter.id }, orderBy: { name: 'asc' } }),
      ]);
      payload.watchlist = { items: mapWatchlistItems(items), tags: mapWatchlistTags(tags) };
    }

    if (wantScheduledAlerts) {
      // Scheduled alerts are per-user; back up the exporter's own active rules.
      const byUser = await loadScheduledAlertsByUser(exporter.id);
      payload.scheduledAlerts = { alerts: byUser.get(exporter.id) ?? [] };
    }

    if (wantAnimeMappings) {
      const [mappings, sonarrConnections] = await Promise.all([
        prisma.aniListSeriesMapping.findMany({
          include: { entries: { orderBy: { order: 'asc' } } },
          orderBy: [{ sonarrInstanceId: 'asc' }, { sonarrSeriesId: 'asc' }],
        }),
        prisma.serviceConnection.findMany({
          where: { type: 'SONARR' },
          select: { id: true, label: true },
        }),
      ]);
      const labelById = new Map(sonarrConnections.map((c) => [c.id, c.label] as const));
      const exportedMappings: ExportedAnimeMapping[] = mappings.map((m) => ({
        sonarrInstanceLabel: labelById.get(m.sonarrInstanceId) ?? '',
        sonarrSeriesId: m.sonarrSeriesId,
        state: m.state,
        matchMethod: m.matchMethod ?? null,
        confidence: m.confidence ?? null,
        seriesTitleSnapshot: m.seriesTitleSnapshot,
        seriesYearSnapshot: m.seriesYearSnapshot ?? null,
        seriesTvdbIdSnapshot: m.seriesTvdbIdSnapshot ?? null,
        seriesTmdbIdSnapshot: m.seriesTmdbIdSnapshot ?? null,
        entries: m.entries.map((e) => ({
          anilistMediaId: e.anilistMediaId,
          isPrimary: e.isPrimary,
          order: e.order,
          source: e.source,
          titleSnapshot: e.titleSnapshot ?? null,
        })),
      }));
      payload.animeMappings = { mappings: exportedMappings };
    }

    if (wantUsers) {
      const users = await prisma.user.findMany({
        include: { settings: true, aniListLink: true },
        orderBy: { createdAt: 'asc' },
      });
      // Per-account content: each user's watchlist, scheduled alerts, and
      // personal dashboard layouts, so a full-instance migration restores
      // every member — not just the exporting admin.
      const [allItems, allTags, allLayouts, alertsByUser] = await Promise.all([
        prisma.watchlistItem.findMany({
          include: { tags: { select: { name: true } } },
          orderBy: { addedAt: 'asc' },
        }),
        prisma.watchlistTag.findMany({ orderBy: { name: 'asc' } }),
        prisma.dashboardLayout.findMany({ orderBy: { createdAt: 'asc' } }),
        loadScheduledAlertsByUser(),
      ]);
      const itemsByUser = new Map<string, WatchlistItemWithTags[]>();
      for (const item of allItems) {
        if (!item.userId) continue; // legacy owner-less rows can't be attributed
        const list = itemsByUser.get(item.userId) ?? [];
        list.push(item);
        itemsByUser.set(item.userId, list);
      }
      const tagsByUser = new Map<string, WatchlistTag[]>();
      for (const tag of allTags) {
        if (!tag.userId) continue;
        const list = tagsByUser.get(tag.userId) ?? [];
        list.push(tag);
        tagsByUser.set(tag.userId, list);
      }
      const layoutsByUser = new Map<string, typeof allLayouts>();
      for (const layout of allLayouts) {
        if (!layout.userId) continue;
        const list = layoutsByUser.get(layout.userId) ?? [];
        list.push(layout);
        layoutsByUser.set(layout.userId, list);
      }
      // Default-layout ids → names (a member may default to a global layout,
      // so resolve against every row, not just their own).
      const layoutNameById = new Map(allLayouts.map((l) => [l.id, l.name] as const));

      const accounts: ExportedUserAccount[] = users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        status: u.status,
        template: u.template,
        permissions: (u.permissions ?? {}) as Record<string, unknown>,
        jellyfinUserId: u.jellyfinUserId ?? null,
        seerrUserId: u.seerrUserId ?? null,
        // passwordHash is a credential — only when secrets are explicitly included.
        ...(includeSecrets ? { passwordHash: u.passwordHash ?? null } : {}),
        settings: u.settings
          ? {
              timeZone: u.settings.timeZone ?? null,
              upcomingNotifyMode: u.settings.upcomingNotifyMode ?? null,
              activityDigestMode: u.settings.activityDigestMode ?? null,
              quietHoursEnabled: u.settings.quietHoursEnabled,
              quietHoursStart: u.settings.quietHoursStart ?? null,
              quietHoursEnd: u.settings.quietHoursEnd ?? null,
              defaultDesktopLayoutName: u.settings.defaultDesktopLayoutId
                ? layoutNameById.get(u.settings.defaultDesktopLayoutId) ?? null
                : null,
              defaultMobileLayoutName: u.settings.defaultMobileLayoutId
                ? layoutNameById.get(u.settings.defaultMobileLayoutId) ?? null
                : null,
            }
          : null,
        // Identity only — OAuth tokens are AES-GCM encrypted with an install key,
        // so they'd never decrypt elsewhere; the user re-authenticates after import.
        anilist: u.aniListLink
          ? {
              anilistUserId: u.aniListLink.anilistUserId ?? null,
              username: u.aniListLink.username ?? null,
              avatar: u.aniListLink.avatar ?? null,
              siteUrl: u.aniListLink.siteUrl ?? null,
              scoreFormat: u.aniListLink.scoreFormat ?? null,
            }
          : null,
        watchlist: {
          items: mapWatchlistItems(itemsByUser.get(u.id) ?? []),
          tags: mapWatchlistTags(tagsByUser.get(u.id) ?? []),
        } satisfies ExportedWatchlist,
        scheduledAlerts: alertsByUser.get(u.id) ?? [],
        dashboardLayouts: (layoutsByUser.get(u.id) ?? []).map((l): ExportedDashboardLayout => ({
          name: l.name,
          isBuiltIn: false,
          slug: null,
          widgets: Array.isArray(l.widgets) ? (l.widgets as unknown[]) : [],
        })),
      }));
      payload.users = { accounts };
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Failed to build settings export', error);
    return NextResponse.json({ error: 'Failed to build export' }, { status: 500 });
  }
}

export const POST = withApiLogging(postHandler, 'api/settings/export', { logBodies: false });
