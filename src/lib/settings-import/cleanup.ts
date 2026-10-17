// Cleanup section (cleaner configs and rules) of a settings import.

import type { Prisma } from '@prisma/client';
import type { ExportedCleanup } from '@/lib/settings-export';
import { toAutoRunMode } from '@/lib/cleanup/types';

export async function applyCleanupInTxn(
  tx: Prisma.TransactionClient,
  data: ExportedCleanup,
  skipped: string[],
): Promise<void> {
  // Configs are singletons — upsert in place.
  if (data.queueConfig && typeof data.queueConfig === 'object') {
    const c = data.queueConfig;
    await tx.queueCleanerConfig.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        enabled: Boolean(c.enabled),
        intervalMinutes: Math.max(1, Number(c.intervalMinutes) || 60),
        ignoredDownloads: Array.isArray(c.ignoredDownloads) ? c.ignoredDownloads : [],
        processNoContentId: Boolean(c.processNoContentId),
        downloadingMetadataMaxStrikes: Math.max(0, Number(c.downloadingMetadataMaxStrikes) || 0),
        failedImport: (c.failedImport ?? {}) as unknown as Prisma.InputJsonValue,
        reSearchAfterRemoval: Boolean(c.reSearchAfterRemoval),
        autoRunMode: toAutoRunMode(c.autoRunMode),
      },
      update: {
        enabled: Boolean(c.enabled),
        intervalMinutes: Math.max(1, Number(c.intervalMinutes) || 60),
        ignoredDownloads: Array.isArray(c.ignoredDownloads) ? c.ignoredDownloads : [],
        processNoContentId: Boolean(c.processNoContentId),
        downloadingMetadataMaxStrikes: Math.max(0, Number(c.downloadingMetadataMaxStrikes) || 0),
        failedImport: (c.failedImport ?? {}) as unknown as Prisma.InputJsonValue,
        reSearchAfterRemoval: Boolean(c.reSearchAfterRemoval),
        autoRunMode: toAutoRunMode(c.autoRunMode),
      },
    });
  } else {
    skipped.push('Cleanup: queueConfig missing or invalid');
  }

  if (data.downloadConfig && typeof data.downloadConfig === 'object') {
    const c = data.downloadConfig;
    const importedPrivacy = typeof c.autoRemoveImportedPrivacyType === 'string'
      && ['public', 'private', 'both'].includes(c.autoRemoveImportedPrivacyType)
      ? c.autoRemoveImportedPrivacyType
      : 'public';
    await tx.downloadCleanerConfig.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        enabled: Boolean(c.enabled),
        intervalMinutes: Math.max(1, Number(c.intervalMinutes) || 60),
        ignoredDownloads: Array.isArray(c.ignoredDownloads) ? c.ignoredDownloads : [],
        autoRemoveImportedEnabled: Boolean(c.autoRemoveImportedEnabled),
        autoRemoveImportedCategories: Array.isArray(c.autoRemoveImportedCategories) ? c.autoRemoveImportedCategories : [],
        autoRemoveImportedDeleteFiles: Boolean(c.autoRemoveImportedDeleteFiles),
        autoRemoveImportedPrivacyType: importedPrivacy,
        autoRunMode: toAutoRunMode(c.autoRunMode),
      },
      update: {
        enabled: Boolean(c.enabled),
        intervalMinutes: Math.max(1, Number(c.intervalMinutes) || 60),
        ignoredDownloads: Array.isArray(c.ignoredDownloads) ? c.ignoredDownloads : [],
        autoRemoveImportedEnabled: Boolean(c.autoRemoveImportedEnabled),
        autoRemoveImportedCategories: Array.isArray(c.autoRemoveImportedCategories) ? c.autoRemoveImportedCategories : [],
        autoRemoveImportedDeleteFiles: Boolean(c.autoRemoveImportedDeleteFiles),
        autoRemoveImportedPrivacyType: importedPrivacy,
        autoRunMode: toAutoRunMode(c.autoRunMode),
      },
    });
  } else {
    skipped.push('Cleanup: downloadConfig missing or invalid');
  }

  // Replace user-defined rules with the imported set. System rules (the
  // synthetic auto-remove-imported seeding rule) are preserved — they're
  // managed by saveDownloadCleanerConfig and will be re-synced on next save.
  // Only delete when a NON-EMPTY replacement array is supplied: a missing or
  // malformed key — or an explicitly empty array (`[]`, which Array.isArray
  // also accepts) — must not silently wipe existing rules. Export always emits
  // full arrays, so legitimate backups still replace correctly; this only
  // closes the "clear-all-via-empty-array" footgun for hand-edited JSON.
  if (Array.isArray(data.stallRules) && data.stallRules.length > 0) {
    await tx.stallRule.deleteMany({});
    const stallRows: Prisma.StallRuleCreateManyInput[] = [];
    for (const r of data.stallRules) {
      if (!r || typeof r !== 'object') continue;
      stallRows.push({
        name: String(r.name ?? 'Stall rule'),
        enabled: Boolean(r.enabled),
        priority: Number(r.priority) || 0,
        maxStrikes: Math.max(3, Number(r.maxStrikes) || 3),
        privacyType: String(r.privacyType ?? 'public'),
        minCompletionPercentage: Math.max(0, Math.min(100, Number(r.minCompletionPercentage) || 0)),
        maxCompletionPercentage: Math.max(1, Math.min(100, Number(r.maxCompletionPercentage) || 100)),
        resetStrikesOnProgress: Boolean(r.resetStrikesOnProgress),
        minimumProgressBytes:
          r.minimumProgressBytes != null && Number.isFinite(Number(r.minimumProgressBytes))
            ? BigInt(Math.max(0, Math.floor(Number(r.minimumProgressBytes))))
            : null,
        changeCategory: Boolean(r.changeCategory),
        deletePrivate: Boolean(r.deletePrivate),
        reSearchOverride: r.reSearchOverride === null || r.reSearchOverride === undefined ? null : Boolean(r.reSearchOverride),
      });
    }
    await tx.stallRule.createMany({ data: stallRows });
  }

  if (Array.isArray(data.slowRules) && data.slowRules.length > 0) {
    await tx.slowRule.deleteMany({});
    const slowRows: Prisma.SlowRuleCreateManyInput[] = [];
    for (const r of data.slowRules) {
      if (!r || typeof r !== 'object') continue;
      slowRows.push({
        name: String(r.name ?? 'Slow rule'),
        enabled: Boolean(r.enabled),
        priority: Number(r.priority) || 0,
        maxStrikes: Math.max(3, Number(r.maxStrikes) || 3),
        privacyType: String(r.privacyType ?? 'public'),
        minCompletionPercentage: Math.max(0, Math.min(100, Number(r.minCompletionPercentage) || 0)),
        maxCompletionPercentage: Math.max(1, Math.min(100, Number(r.maxCompletionPercentage) || 100)),
        minSpeedKbps: r.minSpeedKbps != null ? Math.max(0, Number(r.minSpeedKbps) || 0) : null,
        maxTimeHours: r.maxTimeHours != null ? Math.max(0, Number(r.maxTimeHours) || 0) : null,
        ignoreAboveSizeBytes:
          r.ignoreAboveSizeBytes != null && Number.isFinite(Number(r.ignoreAboveSizeBytes))
            ? BigInt(Math.max(0, Math.floor(Number(r.ignoreAboveSizeBytes))))
            : null,
        resetStrikesOnProgress: Boolean(r.resetStrikesOnProgress),
        changeCategory: Boolean(r.changeCategory),
        deletePrivate: Boolean(r.deletePrivate),
        reSearchOverride: r.reSearchOverride === null || r.reSearchOverride === undefined ? null : Boolean(r.reSearchOverride),
      });
    }
    await tx.slowRule.createMany({ data: slowRows });
  }

  if (Array.isArray(data.seedingRules) && data.seedingRules.length > 0) {
    await tx.seedingRule.deleteMany({ where: { isSystem: false } });
    const seedingRows: Prisma.SeedingRuleCreateManyInput[] = [];
    let restoredRuleLevelConfirmation = false;
    for (const r of data.seedingRules) {
      if (!r || typeof r !== 'object') continue;
      const requireImportedConfirmation = Boolean(r.requireImportedConfirmation);
      const enabled = Boolean(r.enabled);
      if (enabled && requireImportedConfirmation) restoredRuleLevelConfirmation = true;
      seedingRows.push({
        name: String(r.name ?? 'Seeding rule'),
        enabled,
        // Clamp restored priority to >= 0 — the system row's -1000 is
        // reserved and a backup from a buggy build could otherwise land an
        // unconstrained negative.
        priority: Math.max(0, Number(r.priority) || 0),
        categories: Array.isArray(r.categories) ? r.categories : [],
        trackerPatterns: Array.isArray(r.trackerPatterns) ? r.trackerPatterns : [],
        tagsAny: Array.isArray(r.tagsAny) ? r.tagsAny : [],
        tagsAll: Array.isArray(r.tagsAll) ? r.tagsAll : [],
        privacyType: String(r.privacyType ?? 'both'),
        maxRatio: Number.isFinite(Number(r.maxRatio)) ? Number(r.maxRatio) : 1,
        minSeedTimeHours: Math.max(0, Number(r.minSeedTimeHours) || 0),
        maxSeedTimeHours: Number.isFinite(Number(r.maxSeedTimeHours)) ? Number(r.maxSeedTimeHours) : -1,
        deleteSourceFiles: Boolean(r.deleteSourceFiles),
        requireImportedConfirmation,
        isSystem: false,
      });
    }
    await tx.seedingRule.createMany({ data: seedingRows });
    // Enforce mutual exclusion after the rules transaction. If a restored
    // backup contains both the global toggle on AND any rule-level rule, the
    // global wins of the global toggle is the more conservative state; flip it
    // off and let the rule-level rules be the active mechanism.
    if (restoredRuleLevelConfirmation) {
      // upsert (not update) because the backup may not have included
      // downloadConfig, in which case the singleton row may not exist yet.
      await tx.downloadCleanerConfig.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', autoRemoveImportedEnabled: false },
        update: { autoRemoveImportedEnabled: false },
      });
    }
  }
}
