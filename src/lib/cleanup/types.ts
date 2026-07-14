import type { CleanupAction } from '@prisma/client';
import type { QBittorrentTorrent, QueueItem } from '@/types';

export type PrivacyType = 'public' | 'private' | 'both';
export type PatternMode = 'include' | 'exclude';

export type CleanerKind = 'queue' | 'download';
export type StrikeType = 'stall' | 'slow' | 'failedImport' | 'downloadingMetadata';
// Source-of-truth is the Prisma-generated `CleanupAction` enum
// (prisma/schema.prisma); this alias keeps existing imports working.
export type RemovalAction = CleanupAction;
export type TriggeredBy = 'auto' | 'manual' | 'dryRun';
export type AutoRunMode = 'disabled' | 'dryRun' | 'enabled';
export const AUTO_RUN_MODES: AutoRunMode[] = ['disabled', 'dryRun', 'enabled'];

export interface FailedImportConfig {
  maxStrikes: number; // 0 = disabled, else >= 3
  ignorePrivate: boolean;
  deletePrivate: boolean;
  skipIfNotFoundInClient: boolean;
  patternMode: PatternMode;
  patterns: string[];
  changeCategory: boolean;
}

export const DEFAULT_FAILED_IMPORT: FailedImportConfig = {
  maxStrikes: 0,
  ignorePrivate: false,
  deletePrivate: false,
  skipIfNotFoundInClient: true,
  patternMode: 'exclude',
  patterns: [],
  changeCategory: false,
};

export interface QueueCleanerConfigShape {
  enabled: boolean;
  intervalMinutes: number;
  ignoredDownloads: string[];
  processNoContentId: boolean;
  downloadingMetadataMaxStrikes: number;
  failedImport: FailedImportConfig;
  reSearchAfterRemoval: boolean;
  autoRunMode: AutoRunMode;
}

export interface StallRuleShape {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  maxStrikes: number;
  privacyType: PrivacyType;
  minCompletionPercentage: number;
  maxCompletionPercentage: number;
  resetStrikesOnProgress: boolean;
  minimumProgressBytes: number | null;
  changeCategory: boolean;
  deletePrivate: boolean;
  reSearchOverride: boolean | null;
}

export interface SlowRuleShape {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  maxStrikes: number;
  privacyType: PrivacyType;
  minCompletionPercentage: number;
  maxCompletionPercentage: number;
  minSpeedKbps: number | null;
  maxTimeHours: number | null;
  ignoreAboveSizeBytes: number | null;
  resetStrikesOnProgress: boolean;
  changeCategory: boolean;
  deletePrivate: boolean;
  reSearchOverride: boolean | null;
}

export interface SeedingRuleShape {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  categories: string[];
  trackerPatterns: string[];
  tagsAny: string[];
  tagsAll: string[];
  privacyType: PrivacyType;
  maxRatio: number; // -1 disables
  minSeedTimeHours: number;
  maxSeedTimeHours: number; // -1 disables
  deleteSourceFiles: boolean;
  requireImportedConfirmation: boolean;
  isSystem: boolean;
}

export interface DownloadCleanerConfigShape {
  enabled: boolean;
  intervalMinutes: number;
  ignoredDownloads: string[];
  autoRemoveImportedEnabled: boolean;
  autoRemoveImportedCategories: string[];
  autoRemoveImportedDeleteFiles: boolean;
  autoRemoveImportedPrivacyType: PrivacyType;
  autoRunMode: AutoRunMode;
}

export interface LinkedArr {
  source: 'sonarr' | 'radarr';
  instanceId: string;
  instanceLabel: string;
  queueItem: QueueItem;
  contentId: number | null; // seriesId or movieId
  title: string;
}

export interface PendingStrike {
  hash: string;
  torrentName: string;
  strikeType: StrikeType;
  ruleId: string | null;
  ruleName: string | null;
  count: number;
  maxStrikes: number;
  lastSeenAt: Date;
}

export interface QueueDecision {
  torrent: QBittorrentTorrent;
  strikeType: StrikeType;
  ruleId: string | null;
  ruleName: string | null;
  strikeCount: number;
  maxStrikes: number;
  reason: string;
  linked: LinkedArr | null;
  // Every instance whose queue holds this hash (cross-seed / HD+4K both grabbed it).
  // Removal acts on all of them; `linked` stays the representative for display.
  linkedAll?: LinkedArr[];
  options: {
    changeCategory: boolean;
    deletePrivate: boolean;
    reSearch: boolean;
  };
}

export interface DownloadDecision {
  torrent: QBittorrentTorrent;
  rule: SeedingRuleShape;
  reason: string;
  seedingHours: number;
  removalKind: 'imported' | 'seeding';
}

export interface QueueEvaluationResult {
  triggeredBy: TriggeredBy;
  dryRun: boolean;
  decisions: QueueDecision[];
  pendingStrikes: PendingStrike[];
  skippedFailedImport: number;
  durationMs: number;
  succeeded: number;
  failed: number;
  outcomes: CleanupItemOutcome[];
  binding: CleanupExecutionBinding;
}

export interface DownloadEvaluationResult {
  triggeredBy: TriggeredBy;
  dryRun: boolean;
  decisions: DownloadDecision[];
  durationMs: number;
  succeeded: number;
  failed: number;
  outcomes: CleanupItemOutcome[];
  binding: CleanupExecutionBinding;
}

export type CleanupOutcomeStatus = 'succeeded' | 'partial' | 'failed' | 'stale' | 'skipped';

export interface CleanupTargetOutcome {
  target: 'qbittorrent' | 'sonarr' | 'radarr' | 'reSearch';
  instanceId?: string;
  queueItemId?: number;
  attempted: boolean;
  before: 'present' | 'absent' | 'unknown';
  after: 'present' | 'absent' | 'unknown';
  errorMessage?: string;
}

export interface CleanupItemOutcome {
  hash: string;
  torrentName: string;
  status: CleanupOutcomeStatus;
  action: RemovalAction;
  filesDeleted: boolean;
  reSearched: boolean;
  message: string;
  errorMessage: string | null;
  targets: CleanupTargetOutcome[];
}

export interface QueueCandidateBinding {
  cleaner: 'queue';
  hash: string;
  strikeType: StrikeType;
  ruleId: string | null;
  strikeCount: number;
  maxStrikes: number;
  options: QueueDecision['options'];
  links: Array<{
    source: 'sonarr' | 'radarr';
    instanceId: string;
    queueItemId: number;
  }>;
}

export interface DownloadCandidateBinding {
  cleaner: 'download';
  hash: string;
  ruleId: string;
  removalKind: DownloadDecision['removalKind'];
  deleteSourceFiles: boolean;
}

export type CleanupCandidateBinding = QueueCandidateBinding | DownloadCandidateBinding;

export interface CleanupExecutionBinding {
  cleaner: CleanerKind;
  configFingerprint: string;
  scopeFingerprint: string;
  candidatesFingerprint: string;
  candidates: CleanupCandidateBinding[];
}
