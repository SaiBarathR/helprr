import { prisma } from '@/lib/db';
import { sha256Hex, stableStringify } from '@/lib/cache/keys';
import type {
  CleanupCandidateBinding,
  CleanupExecutionBinding,
  CleanerKind,
  DownloadCandidateBinding,
  DownloadCleanerConfigShape,
  DownloadDecision,
  QueueCleanerConfigShape,
  QueueCandidateBinding,
  QueueDecision,
  SeedingRuleShape,
  SlowRuleShape,
  StallRuleShape,
} from './types';

function sortedCandidates(candidates: CleanupCandidateBinding[]): CleanupCandidateBinding[] {
  return [...candidates].sort((a, b) => {
    const hashCmp = a.hash.localeCompare(b.hash);
    if (hashCmp !== 0) return hashCmp;
    return stableStringify(a).localeCompare(stableStringify(b));
  });
}

export function queueCandidateBinding(decision: QueueDecision): QueueCandidateBinding {
  const links = (decision.linkedAll ?? (decision.linked ? [decision.linked] : []))
    .map((link) => ({
      source: link.source,
      instanceId: link.instanceId,
      queueItemId: link.queueItem.id,
    }))
    .sort((a, b) => `${a.source}:${a.instanceId}:${a.queueItemId}`.localeCompare(`${b.source}:${b.instanceId}:${b.queueItemId}`));
  return {
    cleaner: 'queue',
    hash: decision.torrent.hash.toLowerCase(),
    strikeType: decision.strikeType,
    ruleId: decision.ruleId,
    strikeCount: decision.strikeCount,
    maxStrikes: decision.maxStrikes,
    options: { ...decision.options },
    links,
  };
}

export function downloadCandidateBinding(decision: DownloadDecision): DownloadCandidateBinding {
  return {
    cleaner: 'download',
    hash: decision.torrent.hash.toLowerCase(),
    ruleId: decision.rule.id,
    removalKind: decision.removalKind,
    deleteSourceFiles: decision.rule.deleteSourceFiles,
  };
}

export function candidateFingerprint(candidates: CleanupCandidateBinding[]): string {
  return sha256Hex(stableStringify(sortedCandidates(candidates)));
}

export function buildExecutionBinding(
  cleaner: CleanerKind,
  configFingerprint: string,
  scopeFingerprint: string,
  candidates: CleanupCandidateBinding[],
): CleanupExecutionBinding {
  const normalized = sortedCandidates(candidates);
  return {
    cleaner,
    configFingerprint,
    scopeFingerprint,
    candidatesFingerprint: candidateFingerprint(normalized),
    candidates: normalized,
  };
}

export function queueConfigFingerprint(
  config: QueueCleanerConfigShape,
  stallRules: StallRuleShape[],
  slowRules: SlowRuleShape[],
): string {
  return sha256Hex(stableStringify({ config, stallRules, slowRules }));
}

export function downloadConfigFingerprint(
  config: DownloadCleanerConfigShape,
  rules: SeedingRuleShape[],
): string {
  return sha256Hex(stableStringify({ config, rules }));
}

export async function cleanupScopeFingerprint(): Promise<string> {
  const connections = await prisma.serviceConnection.findMany({
    where: { type: { in: ['QBITTORRENT', 'SONARR', 'RADARR'] } },
    select: { id: true, type: true, isDefault: true, updatedAt: true },
    orderBy: [{ type: 'asc' }, { id: 'asc' }],
  });
  return sha256Hex(stableStringify(connections.map((connection) => ({
    ...connection,
    updatedAt: connection.updatedAt.toISOString(),
  }))));
}

export class StaleCleanupPreviewError extends Error {
  constructor(message = 'Cleanup preview is stale. Run a new preview before executing.') {
    super(message);
    this.name = 'StaleCleanupPreviewError';
  }
}

export function assertExecutionBinding(
  expected: CleanupExecutionBinding,
  current: CleanupExecutionBinding,
): void {
  if (
    expected.cleaner !== current.cleaner
    || expected.configFingerprint !== current.configFingerprint
    || expected.scopeFingerprint !== current.scopeFingerprint
    || expected.candidatesFingerprint !== current.candidatesFingerprint
  ) {
    throw new StaleCleanupPreviewError();
  }
}
