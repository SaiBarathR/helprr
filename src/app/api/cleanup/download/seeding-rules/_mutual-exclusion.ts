import { prisma } from '@/lib/db';
import {
  loadDownloadCleanerConfig,
  saveDownloadCleanerConfig,
} from '@/lib/cleanup/download-cleaner';
import { restartDownloadCleaner } from '@/lib/cleanup/scheduler';
import type { SeedingRuleShape } from '@/lib/cleanup/types';

/**
 * Rule-level `requireImportedConfirmation` and the global
 * `autoRemoveImportedEnabled` toggle are mutually exclusive. When a user
 * enables the rule-level flag on any rule, the global toggle is force-flipped
 * to off so there is exactly one "delete on import" mechanism active.
 *
 * Returns `true` when this call flipped the global toggle, so the route can
 * surface that to the UI for a toast.
 */
export async function disableGlobalIfRuleClaimsConfirmation(
  rule: Pick<SeedingRuleShape, 'enabled' | 'requireImportedConfirmation'>,
): Promise<boolean> {
  if (!rule.enabled || !rule.requireImportedConfirmation) return false;
  const cfg = await loadDownloadCleanerConfig();
  if (!cfg.autoRemoveImportedEnabled) return false;
  await saveDownloadCleanerConfig({ ...cfg, autoRemoveImportedEnabled: false });
  await restartDownloadCleaner();
  return true;
}

/**
 * Reverse direction: when the user tries to enable the global toggle, refuse
 * if any enabled user rule still has `requireImportedConfirmation: true`.
 * Returns the list of conflicting rules (id + name) or `null` if clear.
 */
export async function findConflictingRuleLevelRules(): Promise<
  { id: string; name: string }[] | null
> {
  const rows = await prisma.seedingRule.findMany({
    where: {
      enabled: true,
      requireImportedConfirmation: true,
      isSystem: false,
    },
    select: { id: true, name: true },
  });
  return rows.length > 0 ? rows : null;
}
