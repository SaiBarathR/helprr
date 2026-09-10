// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { effectiveBitrate, normalizeBitrateChoice, PlaybackBandwidthEstimate } from '../data-policy';
import { getDeviceProfile } from '../device-profile';
describe('playback data ceiling', () => {
  it('uses a conservative automatic default and explicit saver/manual limits', () => {
    expect(effectiveBitrate(0)).toBe(6_000_000);
    expect(effectiveBitrate(-1, 90_000_000)).toBe(2_000_000);
    expect(effectiveBitrate(15_000_000, 1_000_000)).toBe(15_000_000);
    expect(normalizeBitrateChoice(NaN)).toBe(0);
  });
  it('limits static and transcoded media consistently', () => {
    const profile = getDeviceProfile({ maxStreamingBitrate: 2_000_000 });
    expect(profile.MaxStaticBitrate).toBe(2_000_000);
    expect(profile.MaxStreamingBitrate).toBe(2_000_000);
  });
  it('requires repeated transfer evidence to raise and backs off after a stall', () => {
    const estimator = new PlaybackBandwidthEstimate();
    estimator.observe(2_000_000, 1_000); estimator.observe(2_000_000, 1_000);
    expect(estimator.ceiling).toBe(6_000_000);
    estimator.observe(2_000_000, 1_000);
    expect(estimator.ceiling).toBe(9_600_000);
    estimator.stalled(); expect(estimator.ceiling).toBe(4_800_000);
    estimator.observe(99_000_000, 5); expect(estimator.ceiling).toBe(4_800_000);
  });
});
