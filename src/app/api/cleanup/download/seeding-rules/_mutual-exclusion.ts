import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import {
  loadDownloadCleanerConfig,
  saveDownloadCleanerConfig,
} from '@/lib/cleanup/download-cleaner';
import { restartDownloadCleaner } from '@/lib/cleanup/scheduler';
import type { SeedingRuleShape } from '@/lib/cleanup/types';

type Tx = Prisma.TransactionClient;

/**
 * Transaction-scoped variant: when the caller is already inside a
 * `prisma.$transaction`, flip the global toggle and tear down the system rule
 * using the same `tx` client so the rule write and the mutual-exclusion flip
 * succeed or roll back together.
 *
 * Returns `true` when this call flipped the global toggle. The caller is
 * expected to invoke `restartDownloadCleaner()` after the transaction
 * commits (the scheduler is a global side-effect and can't participate in
 * the transaction).
 */
export async function disableGlobalIfRuleClaimsConfirmationTx(
  tx: Tx,
  rule: Pick<SeedingRuleShape, 'enabled' | 'requireImportedConfirmation'>,
): Promise<boolean> {
  if (!rule.enabled || !rule.requireImportedConfirmation) return false;
  const row = await tx.downloadCleanerConfig.findUnique({ where: { id: 'singleton' } });
  if (!row || !row.autoRemoveImportedEnabled) return false;
  await tx.downloadCleanerConfig.update({
    where: { id: 'singleton' },
    data: { autoRemoveImportedEnabled: false },
  });
  // Mirror the system-rule teardown in syncSystemSeedingRule: when the global
  // toggle goes off the system row must go with it.
  await tx.seedingRule.deleteMany({ where: { isSystem: true } });
  return true;
}

/**
 * Convenience wrapper for callers not already in a transaction. Opens its own
 * `$transaction` and uses the tx-aware helper above, then triggers the
 * scheduler restart.
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
