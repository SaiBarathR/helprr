// Anime mappings section of a settings import.

import type { Prisma } from '@prisma/client';
import { ANIME_MAPPING_STATES, ANIME_MAPPING_ENTRY_SOURCES, type ExportedAnimeMappings } from '@/lib/settings-export';
import { coerceIntOrNull } from './shared';

export async function applyAnimeMappingsInTxn(
  tx: Prisma.TransactionClient,
  data: ExportedAnimeMappings,
  skipped: string[],
): Promise<number> {
  if (!Array.isArray(data.mappings)) {
    skipped.push('Anime mappings: missing mappings array');
    return 0;
  }

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

  let applied = 0;
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
    const label = typeof m.sonarrInstanceLabel === 'string' ? m.sonarrInstanceLabel.trim() : '';
    // A labelled mapping must land on its named instance — never silently fall
    // back to the default, which on a multi-instance install would attach it to
    // the wrong Sonarr. Hard-skip when the label is present but unmatched. When
    // the backup carries no label there's no instance to honor, so defaulting is
    // acceptable.
    if (label && !idByLabel.has(label)) {
      skipped.push(
        `Anime mapping "${m.seriesTitleSnapshot ?? sonarrSeriesId}" skipped: Sonarr instance "${label}" not found on this install.`
      );
      continue;
    }
    const instanceId = (label && idByLabel.get(label)) || defaultSonarr.id;

    // Coerce + dedupe entries (the @@unique([mappingId, anilistMediaId])), then
    // enforce exactly-one-primary.
    const seen = new Set<number>();
    const entries: { anilistMediaId: number; isPrimary: boolean; order: number; source: string; titleSnapshot: string | null }[] = [];
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

    const base = {
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
    };

    const record = await tx.aniListSeriesMapping.upsert({
      where: { sonarrInstanceId_sonarrSeriesId: { sonarrInstanceId: instanceId, sonarrSeriesId } },
      update: base,
      create: { sonarrInstanceId: instanceId, sonarrSeriesId, ...base },
    });

    // Replace the entry set (deleteMany + recreate), same as persistResolution.
    await tx.aniListSeriesMappingEntry.deleteMany({ where: { mappingId: record.id } });
    if (entries.length > 0) {
      await tx.aniListSeriesMappingEntry.createMany({
        data: entries.map((e) => ({
          mappingId: record.id,
          anilistMediaId: e.anilistMediaId,
          isPrimary: e.isPrimary,
          order: e.order,
          source: e.source,
          titleSnapshot: e.titleSnapshot,
        })),
      });
    }
    applied += 1;
  }
  return applied;
}
