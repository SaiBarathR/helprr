import { describe, expect, it } from 'vitest';
import { isIosDevice, pushUnavailableReason } from '@/lib/push-availability';

describe('pushUnavailableReason', () => {
  const base = { secure: true, supported: true, ios: false, standalone: false };

  it('blames plain HTTP first, whatever else is true', () => {
    // A LAN http:// page hides the push APIs, so it also looks "unsupported".
    expect(pushUnavailableReason({ ...base, secure: false, supported: false })).toBe('insecure');
    expect(pushUnavailableReason({ ...base, secure: false, ios: true })).toBe('insecure');
  });

  it('asks iPhone Safari to install first', () => {
    expect(pushUnavailableReason({ ...base, supported: false, ios: true })).toBe('ios-not-installed');
  });

  it('calls an installed iPhone app without push unsupported', () => {
    expect(pushUnavailableReason({ ...base, supported: false, ios: true, standalone: true })).toBe('unsupported');
  });

  it('calls a secure desktop browser without push unsupported', () => {
    expect(pushUnavailableReason({ ...base, supported: false })).toBe('unsupported');
  });

  it('has nothing to say when push works', () => {
    expect(pushUnavailableReason(base)).toBeNull();
    expect(pushUnavailableReason({ ...base, ios: true, standalone: true })).toBeNull();
  });
});

describe('isIosDevice', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)', 'iPhone', 5, true],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5, true],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0, false],
    ['Mozilla/5.0 (Linux; Android 15)', 'Linux armv8l', 5, false],
  ])('%s on %s with %i touch points → %s', (ua, platform, touch, expected) => {
    expect(isIosDevice(ua, platform, touch)).toBe(expected);
  });
});
