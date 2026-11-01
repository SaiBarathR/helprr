import { describe, expect, it } from 'vitest';
import { classifyJobError, nextStepAfterFailure } from './job-errors';

const ERROR = 'ERROR: [youtube] ZoZ7m020aJQ: ';

// yt-dlp's real wording. Only the age message has been seen on this host so far.
describe('YouTube download failures', () => {
  it.each([
    ['Sign in to confirm your age. This video may be inappropriate for some users.', 'ageRestricted'],
    ['Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.', 'blocked'],
    ["Sign in to confirm you're not a bot.", 'blocked'],
    ["This content isn't available, try again later.", 'rateLimited'],
    ['HTTP Error 429: Too Many Requests', 'rateLimited'],
    ["Private video. Sign in if you've been granted access to this video", 'gone'],
    ['Video unavailable. This video has been removed by the uploader', 'gone'],
    ['This video is no longer available because the YouTube account associated with this video has been terminated.', 'gone'],
    ['Join this channel to get access to members-only content like this video, and other exclusive perks.', 'membersOnly'],
    ["This video is available to this channel's members on level: Tier 1", 'membersOnly'],
    ['Premieres in 3 hours', 'notStarted'],
    ['This live event will begin in a few moments.', 'notStarted'],
    ['The uploader has not made this video available in your country', 'regionBlocked'],
    ['The provided YouTube account cookies are no longer valid. They have likely been rotated', 'cookiesExpired'],
    ['Unable to extract player response', 'extractor'],
    ['Requested format is not available', 'extractor'],
    ['connection reset by peer', 'transient'],
  ])('reads "%s"', (message, errorClass) => {
    expect(classifyJobError(`${ERROR}${message}`, 'YOUTUBE')).toBe(errorClass);
  });

  it.each(['ageRestricted', 'membersOnly', 'regionBlocked', 'gone', 'cookiesExpired'] as const)('does not retry %s', (errorClass) => {
    expect(nextStepAfterFailure(errorClass, 1)).toEqual({ state: 'FAILED' });
  });

  it.each(['blocked', 'rateLimited', 'notStarted'] as const)('retries %s slowly, then stops', (errorClass) => {
    expect(nextStepAfterFailure(errorClass, 1)).toEqual({ state: 'RETRY_WAIT', delayMs: 3_600_000 });
    expect(nextStepAfterFailure(errorClass, 3)).toEqual({ state: 'RETRY_WAIT', delayMs: 10_800_000 });
    expect(nextStepAfterFailure(errorClass, 6)).toEqual({ state: 'FAILED' });
  });

  it('leaves Twitch reading the same messages as before', () => {
    expect(classifyJobError('Sign in to confirm your age', 'TWITCH')).toBe('transient');
    expect(classifyJobError('HTTP Error 403: Forbidden', 'TWITCH')).toBe('auth');
  });
});
