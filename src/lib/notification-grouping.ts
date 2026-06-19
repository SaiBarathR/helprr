// Per-poll-cycle notification grouping. When a burst of same-type events for the
// same service lands in one poll cycle (e.g. a season pack that grabs N episode
// queue records at once), this collapses them into a single "N Downloads Started"
// notification instead of firing N pushes + N history rows. The individual items
// are embedded in the grouped row's metadata so the detail drawer can list them.
//
// Grouping happens at generation time, BEFORE notifyEvent's per-device fan-out, so
// it's inherently global. The grouped event keeps the underlying eventType (e.g.
// 'grabbed'), so per-device preference, quiet-hours, and capability gates all still
// apply unchanged.

// Minimum same-key events in one cycle before we collapse them. 1–2 send individually.
export const GROUP_THRESHOLD = 3;

// Cap embedded items so a huge burst can't bloat the metadata JSON. groupCount
// remains the true total for the headline.
const ITEM_CAP = 50;

// Mirrors polling-service's notifyEvent input + log context. Defined here (and
// imported by polling-service) so the collector stays decoupled from the service.
export type NotificationEventInput = {
  eventType: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  url?: string;
  dedupeKey?: string;
  userIds?: string[];
  ownerUserId?: string | null;
};

export type PollNotificationContext = Record<string, unknown> & {
  service: string;
  reason: string;
};

export interface GroupedItem {
  body: string;
  redirect?: string;
  seasonNumber?: number;
  episodeId?: number;
}

type NotifyFn = (event: NotificationEventInput, context: PollNotificationContext) => Promise<number>;

interface Entry {
  event: NotificationEventInput;
  context: PollNotificationContext;
  groupKey: string;
}

function metaString(md: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = md?.[key];
  return typeof v === 'string' ? v : undefined;
}

// Same service instance + same event type in one cycle → one group. qBittorrent
// events carry no instanceId, so all torrentAdded in a cycle share one key.
function deriveGroupKey(event: NotificationEventInput): string {
  const source = metaString(event.metadata, 'source') ?? 'unknown';
  const instanceId = metaString(event.metadata, 'instanceId') ?? '';
  return `${source}:${instanceId}:${event.eventType}`;
}

// Plural nouns for the grouped title, keyed by `${source}:${eventType}` with a
// `*:${eventType}` fallback. Mirrors the singular per-item base titles.
const GROUP_NOUNS: Record<string, string> = {
  'sonarr:grabbed': 'Downloads Started',
  'radarr:grabbed': 'Movie Downloads Started',
  'lidarr:grabbed': 'Album Downloads Started',
  'sonarr:imported': 'Episodes Imported',
  'radarr:imported': 'Movies Imported',
  'lidarr:imported': 'Albums Imported',
  '*:downloadFailed': 'Downloads Failed',
  '*:importFailed': 'Manual Imports Required',
  'qbittorrent:torrentAdded': 'Torrents Added',
  'qbittorrent:torrentCompleted': 'Downloads Complete',
  'qbittorrent:torrentDeleted': 'Torrents Removed',
};

function groupNoun(source: string | undefined, eventType: string): string {
  return (
    GROUP_NOUNS[`${source}:${eventType}`] ??
    GROUP_NOUNS[`*:${eventType}`] ??
    `${eventType} events`
  );
}

// The per-item title is instanceTitle(base, label, n) = n>1 ? `${label} · ${base}` : base.
// Reproduce that prefix on the grouped title only when the per-item title carried it.
function instancePrefix(event: NotificationEventInput): string {
  const label = metaString(event.metadata, 'instanceLabel');
  return label && event.title.startsWith(`${label} · `) ? `${label} · ` : '';
}

// Stable, always-valid destination when the group has no single shared media parent.
function tabRedirect(source: string | undefined, eventType: string): string {
  if (source === 'qbittorrent') return '/torrents';
  if (eventType === 'grabbed') return `/activity?tab=queue&source=${source}`;
  if (eventType === 'downloadFailed' || eventType === 'importFailed') return `/activity?tab=failed&source=${source}`;
  if (eventType === 'imported') return '/activity/history';
  return '/notifications';
}

// The metadata value shared by every entry, or null if they differ / it's absent.
function sharedValue(group: Entry[], key: string): unknown {
  const first = group[0].event.metadata?.[key];
  if (first == null) return null;
  return group.every((e) => e.event.metadata?.[key] === first) ? first : null;
}

// Deep-link the group to the one media parent its items share (the common
// single-series burst); otherwise fall back to the activity tab.
function sharedParentHref(group: Entry[]): string | null {
  const instanceId = metaString(group[0].event.metadata, 'instanceId');
  const q = instanceId ? `?instance=${instanceId}` : '';
  const seriesId = sharedValue(group, 'seriesId');
  if (seriesId != null) return `/series/${seriesId}${q}`;
  const movieId = sharedValue(group, 'movieId');
  if (movieId != null) return `/movies/${movieId}${q}`;
  const artistId = sharedValue(group, 'artistId');
  if (artistId != null) return `/music/${artistId}${q}`;
  return null;
}

function buildGroupedNotification(group: Entry[]): {
  event: NotificationEventInput;
  context: PollNotificationContext;
} {
  const first = group[0].event;
  const eventType = first.eventType;
  const count = group.length;
  const source = metaString(first.metadata, 'source');

  const title = `${instancePrefix(first)}${count} ${groupNoun(source, eventType)}`;

  // Body: up to 3 distinct item bodies; identical bodies (a single season pack)
  // collapse to one line with no "and N more".
  const shown: string[] = [];
  for (const e of group) {
    if (shown.length >= 3) break;
    if (!shown.includes(e.event.body)) shown.push(e.event.body);
  }
  const representedCount = group.filter((e) => shown.includes(e.event.body)).length;
  const remaining = count - representedCount;
  const body = shown.join(' · ') + (remaining > 0 ? ` · …and ${remaining} more` : '');

  const redirect = sharedParentHref(group) ?? tabRedirect(source, eventType);

  const items: GroupedItem[] = group.slice(0, ITEM_CAP).map((e) => {
    const md = e.event.metadata ?? {};
    const item: GroupedItem = { body: e.event.body };
    if (typeof md.redirect === 'string') item.redirect = md.redirect;
    if (typeof md.seasonNumber === 'number') item.seasonNumber = md.seasonNumber;
    if (typeof md.episodeId === 'number') item.episodeId = md.episodeId;
    return item;
  });

  const metadata: Record<string, unknown> = {
    grouped: true,
    groupCount: count,
    items,
    redirect,
  };
  if (source) metadata.source = source;
  const instanceId = metaString(first.metadata, 'instanceId');
  if (instanceId) metadata.instanceId = instanceId;
  const instanceLabel = metaString(first.metadata, 'instanceLabel');
  if (instanceLabel) metadata.instanceLabel = instanceLabel;

  // Preserve per-device quality/tag filtering for the common homogeneous burst:
  // a single shared quality + the union of tags let notifyEvent's matchesFilters
  // pass when an item matches the user's filter.
  const qualities = new Set(
    group
      .map((e) => e.event.metadata?.qualityName)
      .filter((v): v is string => typeof v === 'string'),
  );
  if (qualities.size === 1) metadata.qualityName = [...qualities][0];
  const tags = new Set<string>();
  for (const e of group) {
    const t = e.event.metadata?.tags;
    if (Array.isArray(t)) for (const x of t) tags.add(String(x));
  }
  if (tags.size > 0) metadata.tags = [...tags];

  const context: PollNotificationContext = {
    service: group[0].context.service,
    reason: `${group[0].context.reason}-grouped`,
    groupCount: count,
  };

  return { event: { eventType, title, body, metadata, url: redirect }, context };
}

/**
 * Accumulates groupable notifications during one poll cycle, then emits them on
 * flush: one grouped notification per (source, instance, eventType) group of
 * GROUP_THRESHOLD+ events, or individual notifications otherwise. When grouping
 * is disabled every event is sent individually, so behavior is byte-for-byte the
 * old path.
 */
export class PollNotificationCollector {
  private entries: Entry[] = [];

  add(event: NotificationEventInput, context: PollNotificationContext): void {
    this.entries.push({ event, context, groupKey: deriveGroupKey(event) });
  }

  get size(): number {
    return this.entries.length;
  }

  async flush(opts: { enabled: boolean; notify: NotifyFn }): Promise<void> {
    const groups = new Map<string, Entry[]>();
    for (const entry of this.entries) {
      const existing = groups.get(entry.groupKey);
      if (existing) existing.push(entry);
      else groups.set(entry.groupKey, [entry]);
    }
    this.entries = [];

    for (const group of groups.values()) {
      if (!opts.enabled || group.length < GROUP_THRESHOLD) {
        for (const entry of group) {
          await opts.notify(entry.event, entry.context);
        }
      } else {
        const grouped = buildGroupedNotification(group);
        await opts.notify(grouped.event, grouped.context);
      }
    }
  }
}
