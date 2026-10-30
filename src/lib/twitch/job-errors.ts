export type TwitchErrorClass = 'transient' | 'auth' | 'subOnly' | 'gone' | 'validation' | 'disk' | 'extractor';

const RULES: Array<[RegExp, TwitchErrorClass]> = [
  [/no space left|disk quota/i, 'disk'],
  [/subscriber|sub-only|subscription required|only available to subscribers/i, 'subOnly'],
  [/\b(?:401|403)\b|unauthorized|forbidden|login required|logged.in|invalid.*(?:token|oauth)/i, 'auth'],
  [/\b404\b|not found|does not exist|has been removed|video.*(?:unavailable|deleted)/i, 'gone'],
  [/validation failed|duration mismatch|no (?:video|audio) stream/i, 'validation'],
  [/unsupported url|unable to extract|extractor|no video formats|requested format/i, 'extractor'],
];

export function classifyJobError(message: string): TwitchErrorClass {
  return RULES.find(([pattern]) => pattern.test(message))?.[1] ?? 'transient';
}

const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 60_000;

/** What happens after a failure on the given (1-based) attempt. */
export function nextStepAfterFailure(errorClass: TwitchErrorClass, attempt: number): { state: 'BLOCKED' | 'FAILED' } | { state: 'RETRY_WAIT'; delayMs: number } {
  if (errorClass === 'disk') return { state: 'BLOCKED' };
  if (errorClass !== 'transient' || attempt >= MAX_ATTEMPTS) return { state: 'FAILED' };
  return { state: 'RETRY_WAIT', delayMs: BASE_BACKOFF_MS * 2 ** (attempt - 1) };
}
