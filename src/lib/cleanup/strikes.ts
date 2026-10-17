import { prisma } from '@/lib/db';
import type { StrikeType } from './types';

export interface StrikeKey {
  hash: string;
  strikeType: StrikeType;
  ruleId: string | null;
}

export interface StrikeRecord {
  hash: string;
  strikeType: StrikeType;
  ruleId: string | null;
  count: number;
  lastDownloadedBytes: bigint | null;
  torrentAddedAt: Date | null;
  lastSeenAt: Date;
}

export async function loadActiveStrikes(): Promise<Map<string, StrikeRecord>> {
  const rows = await prisma.cleanupStrike.findMany();
  const map = new Map<string, StrikeRecord>();
  for (const r of rows) {
    map.set(strikeKey(r.hash, r.strikeType as StrikeType, r.ruleId), {
      hash: r.hash,
      strikeType: r.strikeType as StrikeType,
      ruleId: r.ruleId,
      count: r.count,
      lastDownloadedBytes: r.lastDownloadedBytes,
      torrentAddedAt: r.torrentAddedAt,
      lastSeenAt: r.lastSeenAt,
    });
  }
  return map;
}

/** qBittorrent's added_on (epoch seconds) as a date; null when it reports none. */
export function torrentAddedAt(addedOn: number): Date | null {
  return Number.isFinite(addedOn) && addedOn > 0 ? new Date(addedOn * 1000) : null;
}

/**
 * Drops strikes counted for an earlier copy of a torrent: a hash removed and
 * added again (an Arr re-grabbing the same release) starts from no strikes,
 * even if clearing the old ones failed. A strike with no recorded add time
 * (from before it was recorded) still counts.
 */
export function strikesForCurrentTorrents(
  strikes: Map<string, StrikeRecord>,
  torrents: { hash: string; added_on: number }[],
): Map<string, StrikeRecord> {
  const addedAt = new Map(torrents.map((t) => [t.hash.toLowerCase(), torrentAddedAt(t.added_on)]));
  const current = new Map<string, StrikeRecord>();
  for (const [key, strike] of strikes) {
    const torrentAdded = addedAt.get(strike.hash.toLowerCase());
    if (strike.torrentAddedAt && torrentAdded && strike.torrentAddedAt.getTime() !== torrentAdded.getTime()) continue;
    current.set(key, strike);
  }
  return current;
}

export function strikeKey(hash: string, strikeType: StrikeType, ruleId: string | null): string {
  return `${hash.toLowerCase()}::${strikeType}::${ruleId ?? '-'}`;
}

export interface PendingChange {
  kind: 'upsert' | 'clear';
  hash: string;
  torrentName: string;
  strikeType: StrikeType;
  ruleId: string | null;
  newCount?: number;
  lastDownloadedBytes?: bigint | null;
  torrentAddedAt?: Date | null;
}

export class StrikeJournal {
  private changes: PendingChange[] = [];

  upsert(input: {
    hash: string;
    torrentName: string;
    strikeType: StrikeType;
    ruleId: string | null;
    newCount: number;
    lastDownloadedBytes: bigint | null;
    torrentAddedAt: Date | null;
  }) {
    this.changes.push({ kind: 'upsert', ...input });
  }

  clear(input: { hash: string; strikeType: StrikeType; ruleId: string | null; torrentName: string }) {
    this.changes.push({ kind: 'clear', newCount: 0, ...input });
  }

  list(): PendingChange[] {
    return this.changes;
  }

  async persist(): Promise<void> {
    for (const ch of this.changes) {
      if (ch.kind === 'clear') {
        await prisma.cleanupStrike.deleteMany({
          where: { hash: ch.hash, strikeType: ch.strikeType, ruleId: ch.ruleId },
        });
        continue;
      }
      const existing = await prisma.cleanupStrike.findFirst({
        where: { hash: ch.hash, strikeType: ch.strikeType, ruleId: ch.ruleId },
      });
      if (existing) {
        await prisma.cleanupStrike.update({
          where: { id: existing.id },
          data: {
            torrentName: ch.torrentName,
            count: ch.newCount ?? 1,
            lastDownloadedBytes: ch.lastDownloadedBytes ?? null,
            torrentAddedAt: ch.torrentAddedAt ?? null,
            lastSeenAt: new Date(),
          },
        });
      } else {
        await prisma.cleanupStrike.create({
          data: {
            hash: ch.hash,
            torrentName: ch.torrentName,
            strikeType: ch.strikeType,
            ruleId: ch.ruleId,
            count: ch.newCount ?? 1,
            lastDownloadedBytes: ch.lastDownloadedBytes ?? null,
            torrentAddedAt: ch.torrentAddedAt ?? null,
          },
        });
      }
    }
  }
}

export async function clearAllStrikesForHash(hash: string): Promise<void> {
  await prisma.cleanupStrike.deleteMany({ where: { hash: hash.toLowerCase() } });
}

export async function pruneOrphanStrikes(currentHashes: string[]): Promise<void> {
  const set = new Set(currentHashes.map((h) => h.toLowerCase()));
  const all = await prisma.cleanupStrike.findMany({ select: { id: true, hash: true, updatedAt: true } });
  const cutoff = Date.now() - 60 * 60 * 1000;
  const toDelete: string[] = [];
  for (const r of all) {
    if (set.has(r.hash.toLowerCase())) continue;
    if (r.updatedAt.getTime() < cutoff) toDelete.push(r.id);
  }
  if (toDelete.length > 0) {
    await prisma.cleanupStrike.deleteMany({ where: { id: { in: toDelete } } });
  }
}

/**
 * When a user lowers `maxStrikes` on a rule, cap any existing strikes that
 * would otherwise trigger immediate removal on the next cycle. We set them to
 * `newMax - 1`, so the torrent gets at least one more chance before deletion.
 *
 * Pass the rule's `strikeType` (stall/slow) and `ruleId`, plus the new max.
 */
export async function capStrikesToThreshold(
  strikeType: StrikeType,
  ruleId: string,
  newMaxStrikes: number,
): Promise<{ capped: number }> {
  if (!Number.isFinite(newMaxStrikes) || newMaxStrikes <= 0) return { capped: 0 };
  const cap = Math.max(0, Math.floor(newMaxStrikes) - 1);
  const r = await prisma.cleanupStrike.updateMany({
    where: { strikeType, ruleId, count: { gt: cap } },
    data: { count: cap },
  });
  return { capped: r.count };
}

export async function pruneStrikesForMissingRules(): Promise<void> {
  const [stallIds, slowIds] = await Promise.all([
    prisma.stallRule.findMany({ select: { id: true } }),
    prisma.slowRule.findMany({ select: { id: true } }),
  ]);
  const valid = new Set<string>([...stallIds.map((r) => r.id), ...slowIds.map((r) => r.id)]);
  const candidates = await prisma.cleanupStrike.findMany({
    where: { ruleId: { not: null } },
    select: { id: true, ruleId: true },
  });
  const toDelete = candidates.filter((c) => c.ruleId && !valid.has(c.ruleId)).map((c) => c.id);
  if (toDelete.length > 0) {
    await prisma.cleanupStrike.deleteMany({ where: { id: { in: toDelete } } });
  }
}
