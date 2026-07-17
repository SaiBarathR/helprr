import { beforeEach, describe, expect, it } from 'vitest';
import { resetFailureNotify, shouldNotifyFailure } from '@/lib/cleanup/notify-throttle';

describe('cleanup failure notification throttle', () => {
  beforeEach(() => {
    resetFailureNotify('queue');
    resetFailureNotify('download');
  });

  it('throttles each cleaner independently and can be reset', () => {
    const t0 = 2_000_000_000_000;
    expect(shouldNotifyFailure('queue', t0)).toBe(true);
    expect(shouldNotifyFailure('queue', t0 + 60_000)).toBe(false);
    expect(shouldNotifyFailure('queue', t0 + 31 * 60_000)).toBe(true);
    expect(shouldNotifyFailure('download', t0 + 60_000)).toBe(true);
    resetFailureNotify('queue');
    expect(shouldNotifyFailure('queue', t0 + 120_000)).toBe(true);
  });
});
