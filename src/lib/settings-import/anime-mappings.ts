// Anime mappings section of a settings import. prepareAnimeMappings validates
// and normalizes the file's mappings before the transaction opens; the apply
// step resolves their Sonarr instances and writes them with a fixed number of
// bulk statements plus one update per mapping that already exists.

import type { Prisma } from '@prisma/client';
import { ANIME_MAPPING_STATES, ANIME_MAPPING_ENTRY_SOURCES, type ExportedAnimeMappings } from '@/lib/settings-export';
import { coerceIntOrNull } from './shared';

// Rows per bulk statement, well inside PostgreSQL's bind-parameter limit.
const BATCH = 1_000;

interface PreparedEntry {
  anilistMediaId: number;
  isPrimary: boolean;
  order: number;
  source: string;
  titleSnapshot: string | null;
}

interface PreparedMapping {
  label: string;
  sonarrSeriesId: number;
  /** What to show in a skip note. */
  displayName: string;
  base: {
    state: string;
    matchMethod: string | null;
    confidence: number | null;
    seriesTitleSnapshot: string;
    seriesYearSnapshot: number | null;
    seriesTvdbIdSnapshot: number | null;
    seriesTmdbIdSnapshot: number | null;
  };
  entries: PreparedEntry[];
}

/** Validate and normalize the mappings; null when the section has no mappings array. */
export function prepareAnimeMappings(data: ExportedAnimeMappings, skipped: string[]): PreparedMapping[] | null {
  if (!Array.isArray(data.mappings)) {
    skipped.push('Anime mappings: missing mappings array');
    return null;
  }

  const prepared: PreparedMapping[] = [];
  for (const m of data.mappings) {
    if (!m || typeof m !== 'object') continue;
    const state = typeof m.state === 'string' && ANIME_MAPPING_STATES.has(m.state) ? m.state : null;
    if (!state) {
      skipped.push(`Anime mapping skipped: unknown state "${String(m.state)}"`);
      continue;
    }
    const sonarrSeriesId = coerceIntOrNull(m.sonarrSeriesId);
    if (sonarrSeriesId === null || sonarrSeriesId <= 0) {
      skipped.push('Anime mapping skipped: invalid sonarrSeriesId');
      continue;
    }

    // Coerce + dedupe entries (the @@unique([mappingId, anilistMediaId])), then
    // enforce exactly-one-primary.
    const seen = new Set<number>();
    const entries: PreparedEntry[] = [];
    for (const e of Array.isArray(m.entries) ? m.entries : []) {
      if (!e || typeof e !== 'object') continue;
      const anilistMediaId = coerceIntOrNull(e.anilistMediaId) ?? 0;
      if (anilistMediaId <= 0 || seen.has(anilistMediaId)) continue;
      seen.add(anilistMediaId);
      entries.push({
        anilistMediaId,
        isPrimary: Boolean(e.isPrimary),
        order: coerceIntOrNull(e.order) ?? 0,
        source:
          typeof e.source === 'string' && ANIME_MAPPING_ENTRY_SOURCES.has(e.source) ? e.source : 'manual',
        titleSnapshot: typeof e.titleSnapshot === 'string' ? e.titleSnapshot : null,
      });
    }
    const primaryCount = entries.filter((e) => e.isPrimary).length;
    if (entries.length > 0 && primaryCount !== 1) {
      entries.forEach((e, i) => { e.isPrimary = i === 0; });
    }

    prepared.push({
      label: typeof m.sonarrInstanceLabel === 'string' ? m.sonarrInstanceLabel.trim() : '',
      sonarrSeriesId,
      displayName: String(m.seriesTitleSnapshot ?? sonarrSeriesId),
      base: {
        state,
        matchMethod: typeof m.matchMethod === 'string' ? m.matchMethod : null,
        confidence: coerceIntOrNull(m.confidence),
        seriesTitleSnapshot:
          typeof m.seriesTitleSnapshot === 'string' && m.seriesTitleSnapshot.length > 0
            ? m.seriesTitleSnapshot
            : String(sonarrSeriesId),
        seriesYearSnapshot: coerceIntOrNull(m.seriesYearSnapshot),
        seriesTvdbIdSnapshot: coerceIntOrNull(m.seriesTvdbIdSnapshot),
        seriesTmdbIdSnapshot: coerceIntOrNull(m.seriesTmdbIdSnapshot),
      },
      entries,
    });
  }
  return prepared;
}

export async function applyPreparedAnimeMappings(
  tx: Prisma.TransactionClient,
  mappings: PreparedMapping[],
  skipped: string[],
): Promise<number> {
  // Re-resolve each mapping's install-local Sonarr instance id by label. Fall
  // back to the default instance (isDefault flag, else oldest). Read inside the
  // transaction so a mapping never lands on a connection deleted mid-import.
  const sonarrConnections = await tx.serviceConnection.findMany({
    where: { type: 'SONARR' },
    select: { id: true, label: true, isDefault: true, createdAt: true },
  });
  if (sonarrConnections.length === 0) {
    skipped.push('Anime mappings: no Sonarr instances configured — skipped');
    return 0;
  }
  const idByLabel = new Map(sonarrConnections.map((c) => [c.label, c.id] as const));
  const defaultSonarr =
    sonarrConnections.find((c) => c.isDefault) ??
    [...sonarrConnections].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

  // One mapping per (instance, series): a later one replaces an earlier one, as
  // consecutive upserts did.
  const resolved = new Map<string, PreparedMapping & { instanceId: string }>();
  for (const m of mappings) {
    // A labelled mapping must land on its named instance — never silently fall
    // back to the default, which on a multi-instance install would attach it to
    // the wrong Sonarr. Hard-skip when the label is present but unmatched. When
    // the backup carries no label there's no instance to honor, so defaulting is
    // acceptable.
    if (m.label && !idByLabel.has(m.label)) {
      skipped.push(
        `Anime mapping "${m.displayName}" skipped: Sonarr instance "${m.label}" not found on this install.`
      );
      continue;
    }
    const instanceId = (m.label && idByLabel.get(m.label)) || defaultSonarr.id;
    resolved.set(`${instanceId}\u0000${m.sonarrSeriesId}`, { ...m, instanceId });
  }
  const list = [...resolved.values()];
  if (list.length === 0) return 0;

  const key = (row: { sonarrInstanceId: string; sonarrSeriesId: number }) =>
    `${row.sonarrInstanceId}\u0000${row.sonarrSeriesId}`;
  const mappingKey = (m: { instanceId: string; sonarrSeriesId: number }) =>
    key({ sonarrInstanceId: m.instanceId, sonarrSeriesId: m.sonarrSeriesId });
  const idByKey = new Map<string, string>();
  const readIds = async (mappings: typeof list) => {
    const instanceIds = [...new Set(mappings.map((m) => m.instanceId))];
    const seriesIds = [...new Set(mappings.map((m) => m.sonarrSeriesId))];
    for (let i = 0; i < seriesIds.length; i += BATCH) {
      const rows = await tx.aniListSeriesMapping.findMany({
        where: { sonarrInstanceId: { in: instanceIds }, sonarrSeriesId: { in: seriesIds.slice(i, i + BATCH) } },
        select: { id: true, sonarrInstanceId: true, sonarrSeriesId: true },
      });
      for (const row of rows) idByKey.set(key(row), row.id);
    }
  };
  await readIds(list);

  const toCreate = list.filter((m) => !idByKey.has(mappingKey(m)));
  const created = new Set<(typeof list)[number]>();
  for (let i = 0; i < toCreate.length; i += BATCH) {
    const batch = toCreate.slice(i, i + BATCH);
    const rows = await tx.aniListSeriesMapping.createManyAndReturn({
      data: batch.map((m) => ({
        sonarrInstanceId: m.instanceId,
        sonarrSeriesId: m.sonarrSeriesId,
        ...m.base,
      })),
      // A mapping the auto-mapper added since the read is updated below instead.
      skipDuplicates: true,
      select: { id: true, sonarrInstanceId: true, sonarrSeriesId: true },
    });
    for (const row of rows) idByKey.set(key(row), row.id);
    const inserted = new Set(rows.map(key));
    for (const m of batch) if (inserted.has(mappingKey(m))) created.add(m);
  }
  if (created.size < toCreate.length) await readIds(toCreate.filter((m) => !created.has(m)));

  for (const m of list) {
    if (created.has(m)) continue;
    await tx.aniListSeriesMapping.update({
      where: { id: idByKey.get(mappingKey(m)) },
      data: m.base,
    });
  }

  // Replace every imported mapping's entry set (as persistResolution does).
  const mappingIds = list.map((m) => idByKey.get(mappingKey(m))!);
  for (let i = 0; i < mappingIds.length; i += BATCH) {
    await tx.aniListSeriesMappingEntry.deleteMany({ where: { mappingId: { in: mappingIds.slice(i, i + BATCH) } } });
  }
  const entries = list.flatMap((m, i) => m.entries.map((e) => ({ mappingId: mappingIds[i], ...e })));
  for (let i = 0; i < entries.length; i += BATCH) {
    await tx.aniListSeriesMappingEntry.createMany({ data: entries.slice(i, i + BATCH) });
  }
  return list.length;
}
