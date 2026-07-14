export function resolveCleanupHistoryOutcomeStatus(
  outcomeStatus: string | null,
  action: string,
): string | null {
  return outcomeStatus ?? (action === 'failed' ? 'failed' : null);
}
