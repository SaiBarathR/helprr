// Watchlist section of a settings import.

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

export interface WatchlistApplyResult {
  items: number;
  tags: number;
}

export async function applyWatchlistInTxn(
  tx: Prisma.TransactionClient,
  data: ExportedWatchlist,
  skipped: string[],
  ownerUserId: string,
): Promise<WatchlistApplyResult> {
  if (!Array.isArray(data.items)) {
    skipped.push('Watchlist: missing items array');
    return { items: 0, tags: 0 };
  }

  // Upsert tags first so item.tags connect lookups always resolve.
  const incomingTags: { name: string; color: string | null }[] = [];
  if (Array.isArray(data.tags)) {
    for (const t of data.tags) {
      if (!t || typeof t !== 'object' || typeof t.name !== 'string') continue;
      const name = normalizeTagName(t.name);
      if (!name || name.length > 50) continue;
      const color = typeof t.color === 'string' && t.color.length > 0 ? t.color : null;
      incomingTags.push({ name, color });
    }
  }

  // Collect tag names from items so we create any tag the user references
  // even if the export omitted a tag row (or sent items but no tags array).
  const itemTagNames = new Set<string>();
  for (const it of data.items) {
    if (!it || typeof it !== 'object' || !Array.isArray(it.tags)) continue;
    for (const t of it.tags) {
      if (typeof t !== 'string') continue;
      const n = normalizeTagName(t);
      if (n && n.length <= 50) itemTagNames.add(n);
    }
  }

  const allTagNames = new Set(incomingTags.map((t) => t.name));
  for (const n of itemTagNames) allTagNames.add(n);

  // Batch: fetch what already exists, bulk-create the rest, then re-read so
  // we have ids for every name. Same pattern as ensureTagIds() — avoids one
  // round-trip per tag inside the transaction. We intentionally don't update
  // colors of pre-existing tags on import; users tend to recolor in-app and
  // wouldn't expect an import to clobber that.
  const incomingColorByName = new Map(incomingTags.map((t) => [t.name, t.color]));
  const tagIdByName = new Map<string, string>();
  let tagCount = 0;
  if (allTagNames.size > 0) {
    const names = Array.from(allTagNames);
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
          color: incomingColorByName.get(name) ?? pickTagColor(name),
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

  let itemCount = 0;
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

    const tagIds: string[] = [];
    if (Array.isArray(it.tags)) {
      for (const raw of it.tags) {
        if (typeof raw !== 'string') continue;
        const n = normalizeTagName(raw);
        const id = tagIdByName.get(n);
        if (id) tagIds.push(id);
      }
    }

    await tx.watchlistItem.upsert({
      where: {
        userId_source_externalId_mediaType: {
          userId: ownerUserId,
          source: sourceRaw,
          externalId,
          mediaType,
        },
      },
      create: {
        userId: ownerUserId,
        source: sourceRaw,
        externalId,
        mediaType,
        title,
        year,
        posterUrl,
        overview,
        rating,
        reminderAt,
        ...(addedAt ? { addedAt } : {}),
        tags: { connect: tagIds.map((id) => ({ id })) },
      },
      update: {
        title,
        year,
        posterUrl: posterUrl ?? undefined,
        overview: overview ?? undefined,
        rating: rating ?? undefined,
        reminderAt,
        // Reset notifiedAt so a freshly-set reminder fires on the next poll.
        reminderNotifiedAt: null,
        // `connect` (merge) instead of `set` (replace) — re-importing a
        // backup shouldn't silently drop tags the user has added since.
        tags: { connect: tagIds.map((id) => ({ id })) },
      },
    });
    itemCount += 1;
  }

  return { items: itemCount, tags: tagCount };
}
