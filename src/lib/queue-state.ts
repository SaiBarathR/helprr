// Sonarr/Radarr v3 TrackedDownloadState classifier.
//
// Per the v3 OpenAPI, `trackedDownloadState` is one of:
//   downloading | importBlocked | importPending | importing | imported
//   | failedPending | failed | ignored
// and `trackedDownloadStatus` is one of: ok | warning | error.
//
// Lidarr (v1) names its terminal states differently: downloadFailed,
// downloadFailedPending and importFailed (some or all tracks rejected). Sonarr
// and Radarr never send those strings. We classify each queue item into a coarse
// bucket that downstream
// callers (notifications, the Activity "Needs import" tab, the Queue Cleaner) all
// agree on, so symptoms surfaced in one place line up with actions in another.
export type QueueIssue = 'import' | 'download' | null;

export function classifyQueueIssue(
  state: string | undefined | null,
  status: string | undefined | null,
): QueueIssue {
  if (state === 'failed' || state === 'failedPending') return 'download';
  if (state === 'downloadFailed' || state === 'downloadFailedPending') return 'download';
  if (state === 'importBlocked' || state === 'importFailed') return 'import';
  // Sonarr/Radarr also keep some import-rejected items in `importPending`
  // with a warning status (statusMessages explain why — e.g. "Episode title
  // is TBA"). These never auto-promote to importBlocked, so without this
  // branch they look like normal pending items and the user is never told.
  if (state === 'importPending' && (status === 'warning' || status === 'error')) {
    return 'import';
  }
  return null;
}
