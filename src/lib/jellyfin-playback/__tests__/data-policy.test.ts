// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BANDWIDTH_PROBE_TTL_MS, effectiveBitrate, normalizeBitrateChoice, PlaybackBandwidthEstimate } from '../data-policy';
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
  it('starts Automatic from a measured link, which can only lower the first guess', () => {
    const slow = new PlaybackBandwidthEstimate();
    expect(slow.needsProbe(1_000)).toBe(true);
    slow.seed(1_500_000, 1_000); // 1.5 Mbps cellular: 60% of it
    expect(slow.ceiling).toBe(900_000);
    expect(slow.needsProbe(1_000 + BANDWIDTH_PROBE_TTL_MS)).toBe(false);
    expect(slow.needsProbe(1_001 + BANDWIDTH_PROBE_TTL_MS)).toBe(true);

    const fast = new PlaybackBandwidthEstimate();
    fast.seed(400_000_000);
    expect(fast.ceiling).toBe(6_000_000);

    const crawl = new PlaybackBandwidthEstimate();
    crawl.seed(200_000);
    expect(crawl.ceiling).toBe(720_000); // the floor

    const unknown = new PlaybackBandwidthEstimate();
    unknown.seed(0);
    expect(unknown.ceiling).toBe(6_000_000);
    expect(unknown.needsProbe()).toBe(false); // a failed probe is not retried at every start
  });
});
