import type { TwitchVideoType } from '@prisma/client';

const DAY_MS = 86_400_000;

/**
 * Twitch keeps archives 60 days for partners, 14 for affiliates and 7 otherwise.
 * Prime and Turbo also extend it and are not visible through Helix, so this is
 * only ever an estimate. Highlights and uploads do not expire.
 */
export function estimateExpiry(type: TwitchVideoType, createdAt: Date, broadcasterType: string): Date | null {
  if (type !== 'ARCHIVE') return null;
  const days = broadcasterType === 'partner' ? 60 : broadcasterType === 'affiliate' ? 14 : 7;
  return new Date(createdAt.getTime() + days * DAY_MS);
}
