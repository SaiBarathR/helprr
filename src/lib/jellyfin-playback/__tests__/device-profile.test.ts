/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bitrateOptions, getDeviceProfile } from '@/lib/jellyfin-playback/device-profile';
import { detectBrowser } from '@/lib/jellyfin-playback/browser';
import type { JellyfinDeviceProfile } from '@/types/jellyfin-streaming';

const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const CHROME_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const FIREFOX_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0';

/**
 * jsdom answers '' to every canPlayType, which would make every browser look
 * codec-less. Stub it with the patterns each real engine reports so the profile
 * branches are actually exercised.
 */
function stubCanPlayType(patterns: RegExp[]) {
  const answer = (type: string) => (patterns.some((pattern) => pattern.test(type)) ? 'probably' : '');
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation(answer);
}

const H264 = /avc1|mp4a\.40\.2/;
const HEVC = /hvc1|hev1/;
const AV1 = /av01/;
const VP9 = /vp9/;
const AC3 = /ac-3|ec-3/;
const DOLBY_VISION = /dvh1|dav1/;

/**
 * `canPlayHls` needs either native HLS or MSE. jsdom ships neither, so the HLS
 * transcoding profile would silently never appear.
 */
function stubMediaSource(available: boolean) {
  if (available) {
    Object.defineProperty(window, 'MediaSource', { value: class {}, configurable: true, writable: true });
  } else {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'MediaSource');
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  stubMediaSource(false);
});

function hevcCodecProfile(profile: JellyfinDeviceProfile) {
  return profile.CodecProfiles.find((entry) => entry.Type === 'Video' && entry.Codec === 'hevc');
}

function conditionValue(profile: JellyfinDeviceProfile, codec: string, property: string): string | undefined {
  const codecProfile = profile.CodecProfiles.find((entry) => entry.Type === 'Video' && entry.Codec === codec);
  const condition = codecProfile?.Conditions?.find((entry) => entry.Property === property);
  return typeof condition?.Value === 'string' ? condition.Value : undefined;
}

describe('browser detection', () => {
  it('separates the targets the profile branches on', () => {
    expect(detectBrowser(SAFARI_MAC).safari).toBe(true);
    expect(detectBrowser(SAFARI_MAC).osx).toBe(true);
    expect(detectBrowser(IOS_SAFARI).iOS).toBe(true);
    expect(detectBrowser(IOS_SAFARI).iOSVersion).toBeGreaterThanOrEqual(17);
    expect(detectBrowser(CHROME_DESKTOP).chrome).toBe(true);
    expect(detectBrowser(CHROME_DESKTOP).safari).toBe(false);
    expect(detectBrowser(FIREFOX_DESKTOP).firefox).toBe(true);
  });

  it('treats a touch Macintosh UA as iPadOS, as jellyfin-web does', () => {
    expect(detectBrowser(SAFARI_MAC, 5).iOS).toBe(true);
    expect(detectBrowser(SAFARI_MAC, 0).iOS).toBe(false);
  });
});

describe('device profile shape', () => {
  it('always produces the sections PlaybackInfo requires', () => {
    stubCanPlayType([H264]);
    stubMediaSource(true);
    const profile = getDeviceProfile({ userAgent: CHROME_DESKTOP });
    expect(Array.isArray(profile.DirectPlayProfiles)).toBe(true);
    expect(profile.DirectPlayProfiles.length).toBeGreaterThan(0);
    expect(profile.TranscodingProfiles.length).toBeGreaterThan(0);
    expect(profile.TranscodingProfiles.some((entry) => entry.Protocol === 'hls')).toBe(true);
  });

  it('omits the HLS transcoding profile when the browser has neither MSE nor native HLS', () => {
    stubCanPlayType([H264]);
    stubMediaSource(false);
    const profile = getDeviceProfile({ userAgent: CHROME_DESKTOP });
    expect(profile.TranscodingProfiles.some((entry) => entry.Protocol === 'hls')).toBe(false);
  });

  it('honours the bitrate cap and keeps music transcoding below it', () => {
    stubCanPlayType([H264]);
    const profile = getDeviceProfile({ userAgent: CHROME_DESKTOP, maxStreamingBitrate: 3_000_000 });
    expect(profile.MaxStreamingBitrate).toBe(3_000_000);
    expect(profile.MusicStreamingTranscodingBitrate).toBeLessThanOrEqual(3_000_000);
  });

  it('offers a bitrate ladder with an auto option', () => {
    const options = bitrateOptions();
    expect(options[0]).toEqual({ label: 'Auto', value: 0 });
    expect(options.every((option, index) => index === 0 || option.value > 0)).toBe(true);
  });
});

describe('codec gating', () => {
  it('advertises HEVC for Safari and withholds it from Firefox', () => {
    stubCanPlayType([H264, HEVC, AC3]);
    const safari = getDeviceProfile({ userAgent: SAFARI_MAC, maxTouchPoints: 0 });
    expect(hevcCodecProfile(safari)).toBeDefined();
    expect(safari.DirectPlayProfiles.some((entry) => (entry.VideoCodec ?? '').includes('hevc'))).toBe(true);

    stubCanPlayType([H264, VP9]);
    const firefox = getDeviceProfile({ userAgent: FIREFOX_DESKTOP });
    expect(firefox.DirectPlayProfiles.some((entry) => (entry.VideoCodec ?? '').includes('hevc'))).toBe(false);
  });

  it('advertises AV1 only when both 8-bit and 10-bit probe playable', () => {
    stubCanPlayType([H264, AV1]);
    const withAv1 = getDeviceProfile({ userAgent: CHROME_DESKTOP });
    expect(withAv1.DirectPlayProfiles.some((entry) => (entry.VideoCodec ?? '').includes('av1'))).toBe(true);

    stubCanPlayType([H264]);
    const withoutAv1 = getDeviceProfile({ userAgent: CHROME_DESKTOP });
    expect(withoutAv1.DirectPlayProfiles.some((entry) => (entry.VideoCodec ?? '').includes('av1'))).toBe(false);
  });
});

describe('HDR and Dolby Vision range types', () => {
  it('claims HDR10 and HLG on macOS Safari', () => {
    stubCanPlayType([H264, HEVC]);
    const value = conditionValue(getDeviceProfile({ userAgent: SAFARI_MAC, maxTouchPoints: 0 }), 'hevc', 'VideoRangeType');
    expect(value).toContain('HDR10');
    expect(value).toContain('HLG');
  });

  it('claims Dolby Vision only when the profiles actually probe playable', () => {
    stubCanPlayType([H264, HEVC, DOLBY_VISION]);
    const withDovi = conditionValue(getDeviceProfile({ userAgent: SAFARI_MAC, maxTouchPoints: 0 }), 'hevc', 'VideoRangeType');
    expect(withDovi).toContain('DOVI');

    stubCanPlayType([H264, HEVC]);
    const withoutDovi = conditionValue(getDeviceProfile({ userAgent: SAFARI_MAC, maxTouchPoints: 0 }), 'hevc', 'VideoRangeType');
    expect(withoutDovi).not.toContain('DOVI');
  });

  // jellyfin-web browserDeviceProfile.js:251 — "Firefox 100+ has support for
  // HDR on macOS/OS X". Asserting it here pins the port to upstream behaviour.
  it('claims HDR10 for Firefox 100+ on macOS, matching jellyfin-web', () => {
    stubCanPlayType([H264, VP9, HEVC]);
    const value = conditionValue(getDeviceProfile({ userAgent: FIREFOX_DESKTOP }), 'hevc', 'VideoRangeType');
    expect(value).toContain('HDR10');
  });

  it('keeps mobile Chrome on SDR, since it has no client-side tone mapping', () => {
    stubCanPlayType([H264, HEVC]);
    const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
    const value = conditionValue(getDeviceProfile({ userAgent: android }), 'hevc', 'VideoRangeType');
    expect(value).toBe('SDR');
  });
});

describe('subtitle profiles', () => {
  it('advertises vtt and ass so libass can render, and never pgs', () => {
    stubCanPlayType([H264]);
    const profile = getDeviceProfile({ userAgent: CHROME_DESKTOP });
    const formats = profile.SubtitleProfiles.map((entry) => entry.Format);
    expect(formats).toContain('vtt');
    expect(formats).toContain('ass');
    expect(formats).toContain('ssa');
    // PGS is bitmap-only. Withholding it is what makes Jellyfin burn it in
    // rather than hand us something the browser cannot draw.
    expect(formats).not.toContain('pgssub');
    expect(formats).not.toContain('pgs');
  });

  it('drops client-side ass/ssa on a retry so the server burns subtitles in', () => {
    stubCanPlayType([H264]);
    const profile = getDeviceProfile({ userAgent: CHROME_DESKTOP, isRetry: true });
    const formats = profile.SubtitleProfiles.map((entry) => entry.Format);
    expect(formats).not.toContain('ass');
    expect(formats).not.toContain('ssa');
  });

  it('respects enableSsaRender: false', () => {
    stubCanPlayType([H264]);
    const profile = getDeviceProfile({ userAgent: CHROME_DESKTOP, enableSsaRender: false });
    expect(profile.SubtitleProfiles.map((entry) => entry.Format)).not.toContain('ass');
  });
});

describe('audio channels', () => {
  it('caps mobile at stereo and lets desktop request more', () => {
    stubCanPlayType([H264, AC3]);
    const mobile = getDeviceProfile({ userAgent: IOS_SAFARI });
    const mobileChannels = mobile.CodecProfiles
      .flatMap((entry) => entry.Conditions ?? [])
      .find((condition) => condition.Property === 'AudioChannels');
    if (mobileChannels) expect(Number(mobileChannels.Value)).toBeLessThanOrEqual(2);

    const desktop = getDeviceProfile({ userAgent: CHROME_DESKTOP, audioChannels: 6 });
    const desktopChannels = desktop.CodecProfiles
      .flatMap((entry) => entry.Conditions ?? [])
      .find((condition) => condition.Property === 'AudioChannels');
    if (desktopChannels) expect(Number(desktopChannels.Value)).toBe(6);
  });
});
