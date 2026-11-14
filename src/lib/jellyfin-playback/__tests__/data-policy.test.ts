// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BANDWIDTH_PROBE_TTL_MS, effectiveBitrate, measuredStartBitrate, normalizeBitrateChoice, PlaybackBandwidthEstimate } from '../data-policy';
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
  it('starts Automatic at 70% of a measured link, lower or higher than the first guess, for an hour', () => {
    expect(BANDWIDTH_PROBE_TTL_MS).toBe(60 * 60_000);
    const slow = new PlaybackBandwidthEstimate();
    expect(slow.needsProbe(1_000)).toBe(true);
    slow.seed(1_500_000, 1_000); // 1.5 Mbps cellular
    expect(slow.ceiling).toBe(1_100_000); // 1.05 Mbps, to the nearest 100 kbps
    expect(slow.needsProbe(1_000 + BANDWIDTH_PROBE_TTL_MS)).toBe(false);
    expect(slow.needsProbe(1_001 + BANDWIDTH_PROBE_TTL_MS)).toBe(true);

    const wifi = new PlaybackBandwidthEstimate();
    wifi.seed(40_000_000);
    expect(wifi.ceiling).toBe(28_000_000); // raised past the 6 Mbps guess

    const lan = new PlaybackBandwidthEstimate();
    lan.seed(400_000_000);
    expect(lan.ceiling).toBe(120_000_000); // the highest quality the picker offers

    const crawl = new PlaybackBandwidthEstimate();
    crawl.seed(200_000);
    expect(crawl.ceiling).toBe(720_000); // the floor

    const unknown = new PlaybackBandwidthEstimate();
    unknown.seed(0);
    expect(unknown.ceiling).toBe(6_000_000);
    expect(unknown.needsProbe()).toBe(false); // a failed probe is not retried at every start
  });
  it('caps a measurement at 70% of the connection top speed, in bits', () => {
    expect(measuredStartBitrate(50_000_000)).toBe(35_000_000);
    expect(measuredStartBitrate(50_000_000, 10)).toBe(7_000_000); // a 10 Mbps connection type
    expect(measuredStartBitrate(50_000_000, Infinity)).toBe(35_000_000); // "unknown" in Chrome
    expect(measuredStartBitrate(50_000_000, 0)).toBe(35_000_000);
    const estimate = new PlaybackBandwidthEstimate();
    estimate.seed(50_000_000, Date.now(), 10);
    expect(estimate.ceiling).toBe(7_000_000);
  });
  it('replaces a learned or stalled ceiling with the new measurement', () => {
    const learned = new PlaybackBandwidthEstimate();
    for (let i = 0; i < 3; i++) learned.observe(2_000_000, 1_000);
    expect(learned.ceiling).toBe(9_600_000);
    learned.seed(50_000_000);
    expect(learned.ceiling).toBe(35_000_000);
    learned.seed(5_000_000);
    expect(learned.ceiling).toBe(3_500_000); // the link really got slower

    const stalled = new PlaybackBandwidthEstimate();
    stalled.stalled();
    expect(stalled.ceiling).toBe(3_000_000);
    stalled.seed(50_000_000);
    expect(stalled.ceiling).toBe(35_000_000);
  });
});
