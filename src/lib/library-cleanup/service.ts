// Library cleanup ("Leaving soon"): preview → mark → (countdown) → Delete now.
//
// Nothing here deletes on its own. Deletion is an explicit admin run bound to a
// single-use preview token; at execute time every exclusion is re-checked
// against freshly read Sonarr/Radarr, Jellyfin and Seerr data (any of them
// unreadable → nothing is deleted), and every title gets a CleanupHistory row
// plus, for each delete call, a FileOperationAudit row.

import { isAxiosError } from 'axios';
import { Prisma, type LeavingSoonItem } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { can } from '@/lib/permissions';
import { notifyEvent } from '@/lib/notification-service';
import { recordOperationAudit, runWithOperationAudit, type AuditActor } from '@/lib/file-audit';
import { getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import { invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import { sha256Hex, stableStringify } from '@/lib/cache/keys';
import {
  assertExecutionBinding,
  buildExecutionBinding,
  cleanupScopeFingerprint,
} from '@/lib/cleanup/binding';
import type { CleanupExecutionBinding, LibraryCandidateBinding } from '@/lib/cleanup/types';
import {
  LIBRARY_MEDIA_TYPES,
  loadLibraryCleanupSettings,
  ruleFor,
  type LibraryCleanupSettings,
  type LibraryMediaType,
} from './config';
import { evaluateTitle, exclusionsFor, titleKey, type TitleFacts } from './evaluate';
import { gatherLibraryFacts } from './inputs';

const LOG = 'library-cleanup';
export const MAX_MARK_ITEMS = 500;

export interface CandidateView {
  key: string;
  mediaType: LibraryMediaType;
  instanceId: string;
  instanceLabel: string;
  arrId: number;
  title: string;
  year: number | null;
  posterUrl: string | null;
  sizeBytes: number;
  lastWatchedAt: string | null;
  requestedBy: string[];
  reasons: string[];
  leavingSoon: boolean;
}

function toCandidate(t: TitleFacts, reasons: string[], leavingSoon: boolean): CandidateView {
  return {
    key: titleKey(t),
    mediaType: t.mediaType,
    instanceId: t.instanceId,
    instanceLabel: t.instanceLabel,
    arrId: t.arrId,
    title: t.title,
    year: t.year,
    posterUrl: t.posterUrl,
    sizeBytes: t.sizeBytes,
    lastWatchedAt: t.lastWatchedAt?.toISOString() ?? null,
    requestedBy: t.requestedBy,
    reasons,
    leavingSoon,
  };
}

// ── Preview (read-only) ─────────────────────────────────────────────────────

export async function previewLibraryCandidates(mediaType: LibraryMediaType, now = Date.now()) {
  const settings = await loadLibraryCleanupSettings();
  const rule = ruleFor(settings, mediaType);
  const { titles, warnings } = await gatherLibraryFacts(mediaType, settings.keepTag, now);
  const marked = await prisma.leavingSoonItem.findMany({
    where: { mediaType },
    select: { service: true, instanceId: true, arrId: true },
  });
  const markedKeys = new Set(marked.map(titleKey));

  const candidates: CandidateView[] = [];
  const excluded = new Map<string, number>();
  for (const t of titles) {
    const evaluation = evaluateTitle(t, rule, settings.keepTag, now);
    if (evaluation.qualifies) {
      candidates.push(toCandidate(t, evaluation.reasons, markedKeys.has(titleKey(t))));
    }
    for (const reason of evaluation.exclusions) excluded.set(reason, (excluded.get(reason) ?? 0) + 1);
  }
  candidates.sort((a, b) => b.sizeBytes - a.sizeBytes || a.title.localeCompare(b.title));
  return {
    mediaType,
    rule,
    scanned: titles.length,
    candidates,
    totalBytes: candidates.reduce((sum, c) => sum + c.sizeBytes, 0),
    excluded: [...excluded].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    warnings,
  };
}

// ── Mark Leaving soon ───────────────────────────────────────────────────────

export interface MarkResult {
  marked: Array<{ id: string; key: string; title: string; deleteAfter: string }>;
  skipped: Array<{ key: string; title: string | null; reason: string }>;
}

/**
 * Marks titles Leaving soon. Each one is evaluated again from fresh data, so a
 * title that became protected since the preview is never marked.
 */
export async function markLeavingSoon(
  actor: { id: string; username: string },
  mediaType: LibraryMediaType,
  keys: string[],
  now = Date.now(),
): Promise<MarkResult> {
  const settings = await loadLibraryCleanupSettings();
  const rule = ruleFor(settings, mediaType);
  const { titles } = await gatherLibraryFacts(mediaType, settings.keepTag, now);
  const byKey = new Map(titles.map((t) => [titleKey(t), t]));
  const deleteAfter = new Date(now + settings.countdownDays * 24 * 60 * 60 * 1000);
  const result: MarkResult = { marked: [], skipped: [] };
  const created: Array<{ item: LeavingSoonItem; facts: TitleFacts }> = [];

  for (const key of [...new Set(keys)]) {
    const t = byKey.get(key);
    if (!t) {
      result.skipped.push({ key, title: null, reason: 'No longer in the library' });
      continue;
    }
    const evaluation = evaluateTitle(t, rule, settings.keepTag, now);
    if (!evaluation.qualifies) {
      result.skipped.push({ key, title: t.title, reason: evaluation.exclusions.join(', ') || 'No longer matches the rule' });
      continue;
    }
    try {
      const item = await prisma.leavingSoonItem.create({
        data: {
          mediaType,
          service: t.service,
          instanceId: t.instanceId,
          arrId: t.arrId,
          title: t.title,
          year: t.year,
          tmdbId: t.tmdbId,
          tvdbId: t.tvdbId,
          imdbId: t.imdbId,
          posterUrl: t.posterUrl,
          sizeBytes: BigInt(Math.max(0, Math.floor(t.sizeBytes))),
          lastWatchedAt: t.lastWatchedAt,
          reasons: evaluation.reasons,
          requestedBy: t.requestedBy,
          markedByUserId: actor.id,
          markedByUsername: actor.username,
          deleteAfter,
        },
      });
      created.push({ item, facts: t });
      result.marked.push({ id: item.id, key, title: t.title, deleteAfter: deleteAfter.toISOString() });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        result.skipped.push({ key, title: t.title, reason: 'Already leaving soon' });
        continue;
      }
      throw error;
    }
  }

  if (settings.notifyOnMark) {
    for (const { item, facts } of created) await notifyMarked(item, facts);
  }
  return result;
}

/**
 * Tells the people who requested (or watchlisted) a marked title, so they can
 * press Keep. Watchlisted titles are excluded from marking, so in practice
 * these are past requesters. Fail-soft: marking stands if a push fails.
 */
async function notifyMarked(item: LeavingSoonItem, facts: TitleFacts): Promise<void> {
  const userIds = [...new Set([...facts.requesterUserIds, ...facts.watchlistUserIds])];
  if (userIds.length === 0) return;
  const viewCap = item.mediaType === 'movie' ? 'movies.view' : 'series.view';
  try {
    const users = await prisma.user.findMany({ where: { id: { in: userIds }, status: 'active' } });
    const url = `/${item.mediaType === 'movie' ? 'movies' : 'series'}/${item.arrId}?instance=${encodeURIComponent(item.instanceId)}`;
    const date = item.deleteAfter.toISOString().slice(0, 10);
    for (const user of users) {
      if (!can(user, viewCap) || !can(user, 'notify.requests')) continue;
      await notifyEvent({
        eventType: 'leavingSoon',
        title: `Leaving soon: ${item.title}`.slice(0, 200),
        body: `You requested this. It may be removed after ${date}. Open it and press Keep to save it.`,
        url,
        dedupeKey: `leaving-soon-${item.id}-${user.id}`,
        userIds: [user.id],
        ownerUserId: user.id,
        metadata: {
          source: item.service === 'RADARR' ? 'radarr' : 'sonarr',
          instanceId: item.instanceId,
          ...(item.mediaType === 'movie' ? { movieId: item.arrId } : { seriesId: item.arrId }),
          mediaType: item.mediaType,
          redirect: url,
        },
      });
    }
  } catch (error) {
    logger.warn('Leaving soon notification failed', { id: item.id, reason: error instanceof Error ? error.message : String(error) }, { scope: LOG });
  }
}

// ── Keep ────────────────────────────────────────────────────────────────────

/**
 * Adds the keep tag to the title in its own Sonarr/Radarr instance (creating
 * the tag when it does not exist yet), audits it, and only then takes the title
 * off Leaving soon. Throws when the arr call fails; the title stays listed.
 */
export class LeavingSoonClaimedError extends Error {
  constructor() {
    super('This title is already being kept or deleted.');
    this.name = 'LeavingSoonClaimedError';
  }
}

export async function keepLeavingSoonItem(item: LeavingSoonItem, actor: AuditActor): Promise<void> {
  const settings = await loadLibraryCleanupSettings();
  const keepTag = settings.keepTag;
  const client = item.service === 'RADARR' ? await getRadarrClient(item.instanceId) : await getSonarrClient(item.instanceId);
  // Claim first, so a Delete now running at the same moment cannot also take it.
  if (!await claimRow(item.id)) throw new LeavingSoonClaimedError();
  try {
    await tagKeep(item, actor, keepTag, client);
  } catch (error) {
    await restoreRow(item);
    throw error;
  }
  await invalidateTaggedLibrary(item.service === 'RADARR' ? 'radarr' : 'sonarr', item.instanceId);
}

async function tagKeep(
  item: LeavingSoonItem,
  actor: AuditActor,
  keepTag: string,
  client: Awaited<ReturnType<typeof getRadarrClient>> | Awaited<ReturnType<typeof getSonarrClient>>,
): Promise<void> {
  await runWithOperationAudit({
    user: actor,
    service: item.service === 'RADARR' ? 'RADARR' : 'SONARR',
    instanceId: item.instanceId,
    operation: 'KEEP_MEDIA',
    targetType: item.mediaType === 'movie' ? 'movie' : 'series',
    targetId: item.arrId,
    targetTitle: item.title,
    itemCount: 1,
    filesDeleted: null,
    details: { source: 'leaving-soon', leavingSoonId: item.id, tag: keepTag, deleteAfter: item.deleteAfter.toISOString() },
  }, async () => {
    const tags = await client.getTags();
    const tag = tags.find((t) => t.label.toLowerCase() === keepTag) ?? await client.createTag(keepTag);
    if (item.service === 'RADARR') {
      await (client as Awaited<ReturnType<typeof getRadarrClient>>).movieEditor({ movieIds: [item.arrId], tags: [tag.id], applyTags: 'add' });
    } else {
      await (client as Awaited<ReturnType<typeof getSonarrClient>>).seriesEditor({ seriesIds: [item.arrId], tags: [tag.id], applyTags: 'add' });
    }
  });
}

// ── Delete now ──────────────────────────────────────────────────────────────

export type DueStatus = 'ready' | 'protected' | 'gone';

export interface DueItemView {
  id: string;
  key: string;
  mediaType: LibraryMediaType;
  title: string;
  sizeBytes: number;
  deleteAfter: string;
  status: DueStatus;
  exclusions: string[];
}

/** The arr title still carries the provider ids it had when it was marked. */
function sameTitle(item: LeavingSoonItem, facts: { tmdbId: number | null; tvdbId: number | null; imdbId: string | null }): boolean {
  const differs = <T>(a: T | null, b: T | null) => a !== null && b !== null && a !== b;
  if (differs(item.tmdbId, facts.tmdbId) || differs(item.tvdbId, facts.tvdbId)) return false;
  if (differs(item.imdbId?.toLowerCase() ?? null, facts.imdbId?.toLowerCase() ?? null)) return false;
  // With no id to compare at all, refuse rather than guess.
  return Boolean((item.tmdbId && facts.tmdbId) || (item.tvdbId && facts.tvdbId) || (item.imdbId && facts.imdbId));
}

/**
 * Takes the row for one actor. Keep and Delete now both claim it before calling
 * the arr, so exactly one of them acts on a title; the loser sees count 0.
 */
async function claimRow(id: string): Promise<boolean> {
  const { count } = await prisma.leavingSoonItem.deleteMany({ where: { id } });
  return count === 1;
}

/** Puts a claimed row back after the arr call did not go through. */
async function restoreRow(item: LeavingSoonItem): Promise<void> {
  try {
    await prisma.leavingSoonItem.create({
      data: {
        ...item,
        reasons: item.reasons as Prisma.InputJsonValue,
        requestedBy: item.requestedBy as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    logger.error('Could not put a Leaving soon title back', { id: item.id, reason: errorText(error) }, { scope: LOG });
  }
}

export function libraryConfigFingerprint(settings: LibraryCleanupSettings): string {
  return sha256Hex(stableStringify(settings));
}

interface DueEvaluation {
  items: DueItemView[];
  ready: Array<{ item: LeavingSoonItem; facts: TitleFacts; keepTagId: number | null }>;
  gone: LeavingSoonItem[];
  binding: CleanupExecutionBinding;
  warnings: string[];
}

/**
 * Re-checks every exclusion for each title whose countdown has ended, from
 * freshly read data. Throws LibraryCleanupUnavailableError (nothing is
 * deleted) when any source cannot be read.
 */
async function evaluateDue(addImportListExclusion: boolean, now: number): Promise<DueEvaluation> {
  const settings = await loadLibraryCleanupSettings();
  const due = await prisma.leavingSoonItem.findMany({
    where: { deleteAfter: { lte: new Date(now) } },
    orderBy: [{ deleteAfter: 'asc' }, { id: 'asc' }],
  });
  const items: DueItemView[] = [];
  const ready: DueEvaluation['ready'] = [];
  const gone: LeavingSoonItem[] = [];
  const warnings: string[] = [];
  for (const mediaType of LIBRARY_MEDIA_TYPES) {
    const ofType = due.filter((item) => item.mediaType === mediaType);
    if (ofType.length === 0) continue;
    const gathered = await gatherLibraryFacts(mediaType, settings.keepTag, now);
    warnings.push(...gathered.warnings);
    const byKey = new Map(gathered.titles.map((t) => [titleKey(t), t]));
    const rule = ruleFor(settings, mediaType);
    for (const item of ofType) {
      const key = titleKey(item);
      const facts = byKey.get(key);
      let exclusions: string[] = [];
      if (!gathered.keepTagIds.has(item.instanceId)) {
        // The instance is no longer connected: the title may well still exist there.
        exclusions = ['Its Sonarr/Radarr instance is no longer connected'];
      } else if (facts && !sameTitle(item, facts)) {
        // Same id, different title (the arr was rebuilt or restored): never delete what was not marked.
        exclusions = [`Sonarr/Radarr id ${item.arrId} is now "${facts.title}"`];
      } else if (facts) {
        exclusions = exclusionsFor(facts, rule.unwatchedDays, settings.keepTag, now, item.markedAt);
      }
      const status: DueStatus = exclusions.length > 0 ? 'protected' : !facts ? 'gone' : 'ready';
      items.push({
        id: item.id,
        key,
        mediaType,
        title: facts?.title ?? item.title,
        sizeBytes: Number(item.sizeBytes),
        deleteAfter: item.deleteAfter.toISOString(),
        status,
        exclusions,
      });
      if (status === 'ready' && facts) ready.push({ item, facts, keepTagId: gathered.keepTagIds.get(item.instanceId) ?? null });
      if (status === 'gone') gone.push(item);
    }
  }
  const candidates: LibraryCandidateBinding[] = ready.map(({ item }) => ({
    cleaner: 'library',
    hash: titleKey(item),
    leavingSoonId: item.id,
    deleteAfter: item.deleteAfter.toISOString(),
    addImportListExclusion,
  }));
  const binding = buildExecutionBinding(
    'library',
    libraryConfigFingerprint(settings),
    await cleanupScopeFingerprint(),
    candidates,
  );
  return { items, ready, gone, binding, warnings: [...new Set(warnings)] };
}

export async function previewLibraryDeletion(addImportListExclusion: boolean, now = Date.now()) {
  const { items, binding, warnings } = await evaluateDue(addImportListExclusion, now);
  return { items, binding, warnings, readyCount: binding.candidates.length };
}

export type DeletionOutcome = 'deleted' | 'failed' | 'skipped';

export interface DeletionItemResult {
  id: string;
  title: string;
  outcome: DeletionOutcome;
  message?: string;
}

// One run at a time per process, so two admins cannot race the same titles.
let deletionRunning = false;

export class LibraryDeletionBusyError extends Error {
  constructor() {
    super('A library cleanup deletion is already running.');
    this.name = 'LibraryDeletionBusyError';
  }
}

export async function withLibraryDeletionLock<T>(run: () => Promise<T>): Promise<T> {
  if (deletionRunning) throw new LibraryDeletionBusyError();
  deletionRunning = true;
  try {
    return await run();
  } finally {
    deletionRunning = false;
  }
}

/** True when the arr answers 404 for the title, i.e. it is gone. */
async function isGone(item: LeavingSoonItem): Promise<boolean> {
  try {
    if (item.service === 'RADARR') await (await getRadarrClient(item.instanceId)).getMovieById(item.arrId);
    else await (await getSonarrClient(item.instanceId)).getSeriesById(item.arrId);
    return false;
  } catch (error) {
    return isAxiosError(error) && error.response?.status === 404;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeHistory(
  item: LeavingSoonItem,
  outcome: DeletionOutcome,
  reason: string,
  actor: AuditActor,
  previewId: string,
  errorMessage: string | null,
): Promise<void> {
  const service = item.service === 'RADARR' ? 'radarr' : 'sonarr';
  try {
    await prisma.cleanupHistory.create({
      data: {
        cleaner: 'library',
        strikeType: null,
        ruleId: item.mediaType,
        ruleName: item.mediaType === 'movie' ? 'Movies' : 'Series',
        hash: titleKey(item),
        shortHash: `#${item.arrId}`,
        torrentName: item.title,
        reason,
        action: outcome === 'deleted' ? 'removedFromLibrary' : outcome === 'failed' ? 'failed' : 'skipped',
        filesDeleted: outcome === 'deleted',
        reSearched: false,
        linkedArrSource: service,
        linkedArrTitle: item.title,
        linkedArrItemId: item.arrId,
        torrentSize: item.sizeBytes,
        torrentProgress: null,
        torrentRatio: null,
        triggeredBy: 'manual',
        errorMessage,
        previewId,
        outcomeStatus: outcome === 'deleted' ? 'succeeded' : outcome === 'failed' ? 'failed' : 'skipped',
        outcomeDetails: { message: reason, instanceId: item.instanceId, leavingSoonId: item.id },
        actorUserId: actor.id,
        actorUsername: actor.username,
      },
    });
  } catch (error) {
    // The deletion result stands; a missing history row is logged, never reported as a failed delete.
    logger.error('Library cleanup history write failed', { id: item.id, reason: errorText(error) }, { scope: LOG });
  }
}

function idOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function skippedResult(item: LeavingSoonItem, message: string): DeletionItemResult {
  return { id: item.id, title: item.title, outcome: 'skipped', message };
}

async function deleteOne(
  item: LeavingSoonItem,
  facts: TitleFacts,
  keepTagId: number | null,
  addImportListExclusion: boolean,
  actor: AuditActor,
  previewId: string,
): Promise<DeletionItemResult> {
  // Claim the title. If someone pressed Keep while this run was going, they hold it: their choice wins.
  if (!await claimRow(item.id)) {
    await writeHistory(item, 'skipped', 'Kept while the run was going', actor, previewId, null);
    return skippedResult(item, 'Kept while the run was going');
  }

  // A last look at this one title right before the call: a keep tag added in
  // Sonarr/Radarr since the run started, or a different title under the id, stops it.
  let current: { tags?: number[]; tmdbId?: number; tvdbId?: number; imdbId?: string };
  try {
    current = item.service === 'RADARR'
      ? await (await getRadarrClient(item.instanceId)).getMovieById(item.arrId)
      : await (await getSonarrClient(item.instanceId)).getSeriesById(item.arrId);
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) {
      await writeHistory(item, 'skipped', 'No longer in Sonarr/Radarr', actor, previewId, null);
      return skippedResult(item, 'No longer in Sonarr/Radarr');
    }
    await restoreRow(item);
    await writeHistory(item, 'skipped', 'Could not re-read the title', actor, previewId, errorText(error));
    return skippedResult(item, 'Could not re-read the title');
  }
  if (keepTagId !== null && (current.tags ?? []).includes(keepTagId)) {
    // Kept in the arr itself: it leaves Leaving soon.
    await writeHistory(item, 'skipped', 'Tagged keep in Sonarr/Radarr', actor, previewId, null);
    return skippedResult(item, 'Tagged keep in Sonarr/Radarr');
  }
  if (!sameTitle(item, { tmdbId: idOrNull(current.tmdbId), tvdbId: idOrNull(current.tvdbId), imdbId: current.imdbId || null })) {
    await restoreRow(item);
    await writeHistory(item, 'skipped', 'A different title has this id now', actor, previewId, null);
    return skippedResult(item, 'A different title has this id now');
  }

  const reasons = Array.isArray(item.reasons) ? (item.reasons as string[]).join(', ') : '';
  const startedAt = new Date();
  let errorMessage: string | null = null;
  try {
    if (item.service === 'RADARR') {
      await (await getRadarrClient(item.instanceId)).deleteMovie(item.arrId, true, addImportListExclusion);
    } else {
      await (await getSonarrClient(item.instanceId)).deleteSeries(item.arrId, true, addImportListExclusion);
    }
  } catch (error) {
    errorMessage = errorText(error);
  }
  // A failed call may still have deleted it (a lost answer): decide from what the arr shows now.
  const deleted = errorMessage === null || await isGone(item);
  await recordOperationAudit({
    user: actor,
    service: item.service === 'RADARR' ? 'RADARR' : 'SONARR',
    instanceId: item.instanceId,
    operation: 'DELETE_MEDIA',
    targetType: item.mediaType === 'movie' ? 'movie' : 'series',
    targetId: item.arrId,
    targetTitle: item.title,
    itemCount: 1,
    filesDeleted: true,
    details: {
      source: 'library-cleanup',
      previewId,
      leavingSoonId: item.id,
      targetIds: [item.arrId],
      deleteFiles: true,
      addImportListExclusion,
      sizeBytes: Number(item.sizeBytes),
      lastWatchedAt: facts.lastWatchedAt?.toISOString() ?? null,
      reasons: item.reasons,
      callError: errorMessage,
    },
    startedAt,
    success: deleted,
    errorMessage: deleted ? null : errorMessage,
  });
  if (deleted) {
    await writeHistory(item, 'deleted', reasons || 'Leaving soon countdown ended', actor, previewId, null);
    return { id: item.id, title: item.title, outcome: 'deleted' };
  }
  await restoreRow(item);
  await writeHistory(item, 'failed', reasons || 'Leaving soon countdown ended', actor, previewId, errorMessage);
  return { id: item.id, title: item.title, outcome: 'failed', message: errorMessage ?? undefined };
}

/**
 * Executes a consumed deletion preview. Re-reads everything first; if the set
 * of titles that are still safe to delete differs from the preview (one was
 * watched, kept, requested…), the whole run is stale and nothing is deleted.
 */
export async function executeLibraryDeletion(
  expected: CleanupExecutionBinding,
  previewId: string,
  actor: AuditActor,
  now = Date.now(),
): Promise<{ results: DeletionItemResult[]; deleted: number; failed: number; skipped: number }> {
  const first = expected.candidates[0];
  const addImportListExclusion = first?.cleaner === 'library' ? first.addImportListExclusion : false;
  const current = await evaluateDue(addImportListExclusion, now);
  assertExecutionBinding(expected, current.binding);

  const results: DeletionItemResult[] = [];
  for (const { item, facts, keepTagId } of current.ready) {
    results.push(await deleteOne(item, facts, keepTagId, addImportListExclusion, actor, previewId));
  }
  // Titles already removed outside Helprr leave the list (the arr was read in full, so absent is gone).
  for (const item of current.gone) {
    await prisma.leavingSoonItem.deleteMany({ where: { id: item.id } });
    await writeHistory(item, 'skipped', 'No longer in Sonarr/Radarr', actor, previewId, null);
    results.push({ id: item.id, title: item.title, outcome: 'skipped', message: 'No longer in Sonarr/Radarr' });
  }
  const touched = new Set(current.ready.map(({ item }) => `${item.service}:${item.instanceId}`));
  for (const key of touched) {
    const [service, instanceId] = key.split(':');
    await invalidateTaggedLibrary(service === 'RADARR' ? 'radarr' : 'sonarr', instanceId);
  }
  return {
    results,
    deleted: results.filter((r) => r.outcome === 'deleted').length,
    failed: results.filter((r) => r.outcome === 'failed').length,
    skipped: results.filter((r) => r.outcome === 'skipped').length,
  };
}

// ── Shelf ───────────────────────────────────────────────────────────────────

export interface ShelfItemView {
  id: string;
  mediaType: LibraryMediaType;
  instanceId: string;
  arrId: number;
  title: string;
  year: number | null;
  posterUrl: string | null;
  sizeBytes: number;
  markedAt: string;
  deleteAfter: string;
  // Admin only:
  reasons?: string[];
  requestedBy?: string[];
  lastWatchedAt?: string | null;
  markedByUsername?: string;
}

export async function listLeavingSoon(types: LibraryMediaType[], detail: boolean): Promise<ShelfItemView[]> {
  if (types.length === 0) return [];
  const [rows, connections] = await Promise.all([
    prisma.leavingSoonItem.findMany({
      where: { mediaType: { in: types } },
      orderBy: [{ deleteAfter: 'asc' }, { title: 'asc' }],
    }),
    prisma.serviceConnection.findMany({ where: { type: { in: ['RADARR', 'SONARR'] } }, select: { id: true, type: true } }),
  ]);
  // A title whose instance was removed cannot be opened, kept or deleted from here.
  const live = new Set(connections.map((c) => `${c.type}:${c.id}`));
  return rows.filter((row) => live.has(`${row.service}:${row.instanceId}`)).map((row) => ({
    id: row.id,
    mediaType: row.mediaType as LibraryMediaType,
    instanceId: row.instanceId,
    arrId: row.arrId,
    title: row.title,
    year: row.year,
    posterUrl: row.posterUrl,
    sizeBytes: Number(row.sizeBytes),
    markedAt: row.markedAt.toISOString(),
    deleteAfter: row.deleteAfter.toISOString(),
    ...(detail
      ? {
        reasons: Array.isArray(row.reasons) ? row.reasons as string[] : [],
        requestedBy: Array.isArray(row.requestedBy) ? row.requestedBy as string[] : [],
        lastWatchedAt: row.lastWatchedAt?.toISOString() ?? null,
        markedByUsername: row.markedByUsername,
      }
      : {}),
  }));
}
