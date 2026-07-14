import { describe, expect, it } from 'vitest';
import { resolveCleanupHistoryOutcomeStatus } from '@/lib/cleanup/history-status';

describe('cleanup history outcome status', () => {
  it('prefers a reconciled outcome over the legacy action', () => {
    expect(resolveCleanupHistoryOutcomeStatus('partial', 'failed')).toBe('partial');
    expect(resolveCleanupHistoryOutcomeStatus('succeeded', 'failed')).toBe('succeeded');
  });

  it('falls back to the legacy failed action for older history rows', () => {
    expect(resolveCleanupHistoryOutcomeStatus(null, 'failed')).toBe('failed');
    expect(resolveCleanupHistoryOutcomeStatus(null, 'removedFromClient')).toBeNull();
  });
});
