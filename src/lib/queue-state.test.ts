import { describe, expect, it } from 'vitest';
import { classifyQueueIssue } from '@/lib/queue-state';

describe('classifyQueueIssue', () => {
  it.each([
    ['failed', 'warning', 'download'],
    ['failedPending', 'warning', 'download'],
    ['importBlocked', 'warning', 'import'],
    ['importPending', 'warning', 'import'],
    ['importPending', 'ok', null],
    ['downloading', 'ok', null],
    ['imported', 'ok', null],
  ])('classifies Sonarr/Radarr %s/%s as %s', (state, status, issue) => {
    expect(classifyQueueIssue(state, status)).toBe(issue);
  });

  // Lidarr's v1 TrackedDownloadState names its failures differently.
  it.each([
    ['downloadFailed', 'warning', 'download'],
    ['downloadFailedPending', 'warning', 'download'],
    ['importFailed', 'warning', 'import'],
  ])('classifies Lidarr %s/%s as %s', (state, status, issue) => {
    expect(classifyQueueIssue(state, status)).toBe(issue);
  });
});
