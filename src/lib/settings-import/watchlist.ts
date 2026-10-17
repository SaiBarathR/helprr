// Watchlist section of a settings import. prepareWatchlist validates and
// normalizes the file's entries before the transaction opens; the apply step
// then writes them with a fixed number of bulk statements plus one update per
// item that already exists.

import type { Prisma } from '@prisma/client';
import type { ExportedWatchlist } from '@/lib/settings-export';
import {
  isValidExternalId,
  isValidMediaType,
  isValidSource,
  normalizeTagName,
  pickTagColor,
} from '@/lib/watchlist-helpers';
import { WATCHLIST_MAX_TITLE_LEN, WATCHLIST_MAX_OVERVIEW_LEN, validateImportedPosterUrl } from './shared';

// Rows per bulk statement, well inside PostgreSQL's bind-parameter limit.
const BATCH = 1_000;

export interface WatchlistApplyResult {
  items: number;
  tags: number;
}

interface PreparedItem {
  source: string;
  externalId: string;
  mediaType: string;
  title: string;
  year: number | null;
  posterUrl: string | null;
  overview: string | null;
  rating: number | null;
  reminderAt: Date | null;
  addedAt: Date | undefined;
  tagNames: string[];
}

export interface PreparedWatchlist {
  items: PreparedItem[];
  /** Every tag the items or the tag list name, with the file's color if it gave one. */
  tags: Map<string, string | null>;
}

const itemKey = (item: Pick<PreparedItem, 'source' | 'externalId' | 'mediaType'>) =>
  `${item.source}\u0000${item.externalId}\u0000${item.mediaType}`;

/** Validate and normalize a watchlist section; null when it has no items array. */
export function prepareWatchlist(data: ExportedWatchlist, skipped: string[]): PreparedWatchlist | null {
  if (!Array.isArray(data.items)) {
    skipped.push('Watchlist: missing items array');
    return null;
  }

  // Tags named in the tag list or on any item, so a tag an item references is
  // created even when the export omitted its row. Existing tags keep their
  // color; the file's color applies only to tags created here.
  const tags = new Map<string, string | null>();
  if (Array.isArray(data.tags)) {
    for (const t of data.tags) {
      if (!t || typeof t !== 'object' || typeof t.name !== 'string') continue;
      const name = normalizeTagName(t.name);
      if (!name || name.length > 50) continue;
      tags.set(name, typeof t.color === 'string' && t.color.length > 0 ? t.color : null);
    }
  }
  for (const it of data.items) {
    if (!it || typeof it !== 'object' || !Array.isArray(it.tags)) continue;
    for (const t of it.tags) {
      if (typeof t !== 'string') continue;
      const n = normalizeTagName(t);
      if (n && n.length <= 50 && !tags.has(n)) tags.set(n, null);
    }
  }

  // One entry per (source, externalId, mediaType): a later duplicate wins, and
  // its tags join the earlier one's, as consecutive upserts with connect did.
  const items = new Map<string, PreparedItem>();
  for (const it of data.items) {
    if (!it || typeof it !== 'object') continue;
    const sourceRaw = typeof it.source === 'string' ? it.source.toUpperCase() : '';
    const mediaType = typeof it.mediaType === 'string' ? it.mediaType.toLowerCase() : '';
    const externalId = typeof it.externalId === 'string' ? it.externalId
      : typeof it.externalId === 'number' ? String(it.externalId) : '';
    const titleRaw = typeof it.title === 'string' ? it.title.trim() : '';
    if (!isValidSource(sourceRaw) || !isValidMediaType(mediaType) || !isValidExternalId(externalId) || !titleRaw) {
      skipped.push(`Watchlist item "${titleRaw || externalId}" skipped: invalid identifying fields`);
      continue;
    }
    const title = titleRaw.slice(0, WATCHLIST_MAX_TITLE_LEN);

    const year = typeof it.year === 'number' && Number.isFinite(it.year) ? it.year : null;
    let posterUrl: string | null = null;
    if (typeof it.posterUrl === 'string' && it.posterUrl.length > 0) {
      posterUrl = validateImportedPosterUrl(it.posterUrl);
      if (posterUrl === null) {
        skipped.push(`Watchlist item "${title}": posterUrl dropped (invalid scheme or too long)`);
      }
    }
    const overview = typeof it.overview === 'string'
      ? it.overview.slice(0, WATCHLIST_MAX_OVERVIEW_LEN)
      : null;
    const rating = typeof it.rating === 'number' && Number.isFinite(it.rating)
      ? Math.max(0, Math.min(100, it.rating))
      : null;
    // Drop reminders whose timestamp is already in the past so importing a
    // stale backup doesn't fire a push on the very next poll cycle.
    const reminderAt = typeof it.reminderAt === 'string' && it.reminderAt.length > 0
      ? (() => {
          const d = new Date(it.reminderAt);
          if (!Number.isFinite(d.getTime())) return null;
          if (d.getTime() < Date.now()) {
            skipped.push(`Watchlist item "${title}": reminderAt dropped (past timestamp)`);
            return null;
          }
          return d;
        })()
      : null;
    const addedAt = typeof it.addedAt === 'string' && it.addedAt.length > 0
      ? (() => {
          const d = new Date(it.addedAt);
          return Number.isFinite(d.getTime()) ? d : undefined;
        })()
      : undefined;

    const tagNames: string[] = [];
    if (Array.isArray(it.tags)) {
      for (const raw of it.tags) {
        if (typeof raw !== 'string') continue;
        const n = normalizeTagName(raw);
        if (tags.has(n)) tagNames.push(n);
      }
    }

    const item: PreparedItem = {
      source: sourceRaw, externalId, mediaType, title, year, posterUrl, overview, rating, reminderAt, addedAt, tagNames,
    };
    const earlier = items.get(itemKey(item));
    if (earlier) item.tagNames = [...new Set([...earlier.tagNames, ...item.tagNames])];
    items.set(itemKey(item), item);
  }

  return { items: [...items.values()], tags };
}

export async function applyPreparedWatchlist(
  tx: Prisma.TransactionClient,
  prepared: PreparedWatchlist,
  ownerUserId: string,
): Promise<WatchlistApplyResult> {
  // Tags: fetch what exists, bulk-create the rest, then re-read for ids.
  const tagIdByName = new Map<string, string>();
  let tagCount = 0;
  if (prepared.tags.size > 0) {
    const names = [...prepared.tags.keys()];
    const existing = await tx.watchlistTag.findMany({
      where: { userId: ownerUserId, name: { in: names } },
      select: { id: true, name: true },
    });
    for (const row of existing) tagIdByName.set(row.name, row.id);
    tagCount = existing.length;

    const toCreate = names.filter((n) => !tagIdByName.has(n));
    if (toCreate.length > 0) {
      await tx.watchlistTag.createMany({
        data: toCreate.map((name) => ({
          userId: ownerUserId,
          name,
          color: prepared.tags.get(name) ?? pickTagColor(name),
        })),
        skipDuplicates: true,
      });
      const fresh = await tx.watchlistTag.findMany({
        where: { userId: ownerUserId, name: { in: toCreate } },
        select: { id: true, name: true },
      });
      for (const row of fresh) tagIdByName.set(row.name, row.id);
      tagCount += fresh.length;
    }
  }

  // Items: one read finds which already exist; new ones are created in bulk,
  // existing ones updated (the values differ per row).
  const idByKey = new Map<string, string>();
  const readIds = async (items: PreparedItem[]) => {
    const externalIds = [...new Set(items.map((item) => item.externalId))];
    for (let i = 0; i < externalIds.length; i += BATCH) {
      const rows = await tx.watchlistItem.findMany({
        where: { userId: ownerUserId, externalId: { in: externalIds.slice(i, i + BATCH) } },
        select: { id: true, source: true, externalId: true, mediaType: true },
      });
      for (const row of rows) idByKey.set(itemKey(row), row.id);
    }
  };
  await readIds(prepared.items);

  const toCreate = prepared.items.filter((item) => !idByKey.has(itemKey(item)));
  const created = new Set<PreparedItem>();
  for (let i = 0; i < toCreate.length; i += BATCH) {
    const batch = toCreate.slice(i, i + BATCH);
    const rows = await tx.watchlistItem.createManyAndReturn({
      data: batch.map((item) => ({
        userId: ownerUserId,
        source: item.source,
        externalId: item.externalId,
        mediaType: item.mediaType,
        title: item.title,
        year: item.year,
        posterUrl: item.posterUrl,
        overview: item.overview,
        rating: item.rating,
        reminderAt: item.reminderAt,
        ...(item.addedAt ? { addedAt: item.addedAt } : {}),
      })),
      // A row another request added since the read is updated below instead.
      skipDuplicates: true,
      select: { id: true, source: true, externalId: true, mediaType: true },
    });
    for (const row of rows) idByKey.set(itemKey(row), row.id);
    const inserted = new Set(rows.map(itemKey));
    for (const item of batch) if (inserted.has(itemKey(item))) created.add(item);
  }
  if (created.size < toCreate.length) await readIds(toCreate.filter((item) => !created.has(item)));

  for (const item of prepared.items) {
    if (created.has(item)) continue;
    await tx.watchlistItem.update({
      where: { id: idByKey.get(itemKey(item)) },
      data: {
        title: item.title,
        year: item.year,
        posterUrl: item.posterUrl ?? undefined,
        overview: item.overview ?? undefined,
        rating: item.rating ?? undefined,
        reminderAt: item.reminderAt,
        // Reset notifiedAt so a freshly-set reminder fires on the next poll.
        reminderNotifiedAt: null,
      },
    });
  }

  // Tags are added, never replaced: re-importing a backup shouldn't drop tags
  // the user has added since. "A" is the item and "B" the tag in Prisma's
  // implicit many-to-many table.
  const links = prepared.items.flatMap((item) => item.tagNames
    .map((name) => [idByKey.get(itemKey(item)), tagIdByName.get(name)] as const)
    .filter((link): link is readonly [string, string] => Boolean(link[0] && link[1])));
  for (let i = 0; i < links.length; i += BATCH) {
    const batch = links.slice(i, i + BATCH);
    await tx.$executeRaw`
      INSERT INTO "_WatchlistItemTags" ("A", "B")
      SELECT * FROM UNNEST(${batch.map(([item]) => item)}::text[], ${batch.map(([, tag]) => tag)}::text[])
      ON CONFLICT DO NOTHING`;
  }

  return { items: prepared.items.length, tags: tagCount };
}
