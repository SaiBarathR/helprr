import type { ArchivePlatform } from '@prisma/client';

export type TwitchErrorClass = 'transient' | 'auth' | 'subOnly' | 'gone' | 'validation' | 'disk' | 'extractor'
  | 'ageRestricted' | 'blocked' | 'rateLimited' | 'membersOnly' | 'notStarted' | 'regionBlocked' | 'cookiesExpired';

// yt-dlp's own wording. These come first on YouTube, because several read like a general
// "sign in" or "unavailable", and each one needs a different next step.
const YOUTUBE_RULES: Array<[RegExp, TwitchErrorClass]> = [
  [/no space left|disk quota/i, 'disk'],
  [/cookies are no longer valid/i, 'cookiesExpired'],
  [/confirm your age|age-restricted/i, 'ageRestricted'],
  [/not a bot/i, 'blocked'],
  [/content isn.t available, try again later|too many requests|\b429\b/i, 'rateLimited'],
  [/members-only|channel's members|join this channel/i, 'membersOnly'],
  [/premieres? in|live event will begin|scheduled for/i, 'notStarted'],
  [/available in your country|blocked it in your country|not available from your location/i, 'regionBlocked'],
  [/private video|video unavailable|has been removed|no longer available|account .*terminated/i, 'gone'],
  [/validation failed|duration mismatch|no (?:video|audio) stream/i, 'validation'],
  [/unsupported url|unable to extract|extractor|no video formats|requested format/i, 'extractor'],
];

const RULES: Array<[RegExp, TwitchErrorClass]> = [
  [/no space left|disk quota/i, 'disk'],
  [/subscriber|sub-only|subscription required|only available to subscribers/i, 'subOnly'],
  [/\b(?:401|403)\b|unauthorized|forbidden|login required|logged.in|invalid.*(?:token|oauth)/i, 'auth'],
  [/\b404\b|not found|does not exist|has been removed|video.*(?:unavailable|deleted)/i, 'gone'],
  [/validation failed|duration mismatch|no (?:video|audio) stream/i, 'validation'],
  [/unsupported url|unable to extract|extractor|no video formats|requested format/i, 'extractor'],
];

export function classifyJobError(message: string, platform: ArchivePlatform): TwitchErrorClass {
  const rules = platform === 'YOUTUBE' ? YOUTUBE_RULES : RULES;
  return rules.find(([pattern]) => pattern.test(message))?.[1] ?? 'transient';
}

const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 60_000;
// Hammering makes a block last longer, and a premiere keeps its own time.
const SLOW_RETRY_MS = 60 * 60_000;
const SLOW_CLASSES = new Set<TwitchErrorClass>(['blocked', 'rateLimited', 'notStarted']);

/** What happens after a failure on the given (1-based) attempt. */
export function nextStepAfterFailure(errorClass: TwitchErrorClass, attempt: number): { state: 'BLOCKED' | 'FAILED' } | { state: 'RETRY_WAIT'; delayMs: number } {
  if (errorClass === 'disk') return { state: 'BLOCKED' };
  if (SLOW_CLASSES.has(errorClass) && attempt < MAX_ATTEMPTS) return { state: 'RETRY_WAIT', delayMs: SLOW_RETRY_MS * attempt };
  if (errorClass !== 'transient' || attempt >= MAX_ATTEMPTS) return { state: 'FAILED' };
  return { state: 'RETRY_WAIT', delayMs: BASE_BACKOFF_MS * 2 ** (attempt - 1) };
}
