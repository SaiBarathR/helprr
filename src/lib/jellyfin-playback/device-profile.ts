/**
 * Browser DeviceProfile for Jellyfin PlaybackInfo.
 * Ported from jellyfin-web v10.11.1 `src/scripts/browserDeviceProfile.js`
 * for Helprr's PWA/browser targets. TV-only shells are omitted; codec
 * detection still uses canPlayType so Safari/iOS can direct-play HEVC/HDR
 * while Chrome gets a profile that matches MSE + hls.js.
 */

import {
  canPlayHls,
  canPlayNativeHls,
  detectBrowser,
  type HelprrBrowser,
} from '@/lib/jellyfin-playback/browser';
import type {
  JellyfinCodecProfile,
  JellyfinDeviceProfile,
  JellyfinDeviceProfileCondition,
  JellyfinTranscodingProfile,
} from '@/types/jellyfin-streaming';

export interface DeviceProfileOptions {
  maxStreamingBitrate?: number;
  audioChannels?: number;
  enableSsaRender?: boolean;
  isRetry?: boolean;
  userAgent?: string;
  maxTouchPoints?: number;
}

function playable(result: string): boolean {
  return Boolean(result && result.replace(/no/, ''));
}

function canPlayH264(video: HTMLVideoElement): boolean {
  return playable(video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'));
}

function canPlayHevc(video: HTMLVideoElement, browser: HelprrBrowser): boolean {
  return playable(video.canPlayType('video/mp4; codecs="hvc1.1.L120"'))
    || playable(video.canPlayType('video/mp4; codecs="hev1.1.L120"'))
    || playable(video.canPlayType('video/mp4; codecs="hvc1.1.0.L120"'))
    || playable(video.canPlayType('video/mp4; codecs="hev1.1.0.L120"'))
    || (browser.safari || browser.iOS);
}

function canPlayAv1(video: HTMLVideoElement): boolean {
  return playable(video.canPlayType('video/mp4; codecs="av01.0.15M.08"'))
    && playable(video.canPlayType('video/mp4; codecs="av01.0.15M.10"'));
}

function supportsAc3(video: HTMLVideoElement, browser: HelprrBrowser): boolean {
  if (browser.iOS && browser.iOSVersion > 0 && browser.iOSVersion < 11) return false;
  return playable(video.canPlayType('audio/mp4; codecs="ac-3"'));
}

function supportsEac3(video: HTMLVideoElement, browser: HelprrBrowser): boolean {
  if (browser.iOS && browser.iOSVersion > 0 && browser.iOSVersion < 11) return false;
  return playable(video.canPlayType('audio/mp4; codecs="ec-3"'));
}

function supportsAc3InHls(video: HTMLVideoElement): boolean {
  return playable(video.canPlayType('application/x-mpegurl; codecs="avc1.42E01E, ac-3"'))
    || playable(video.canPlayType('application/vnd.apple.mpegURL; codecs="avc1.42E01E, ac-3"'));
}

function supportsMp3InHls(video: HTMLVideoElement): boolean {
  return playable(video.canPlayType('application/x-mpegurl; codecs="avc1.64001E, mp4a.40.34"'))
    || playable(video.canPlayType('application/vnd.apple.mpegURL; codecs="avc1.64001E, mp4a.40.34"'));
}

function canPlayAudioFormat(format: string, browser: HelprrBrowser): boolean {
  if (format === 'alac') return browser.iOS || (browser.osx && browser.safari);
  if (format === 'mp2') return false;
  const audio = document.createElement('audio');
  const types: Record<string, string> = {
    opus: 'audio/ogg; codecs="opus"',
    webma: 'audio/webm',
    mp3: 'audio/mpeg',
    aac: 'audio/mp4',
    flac: 'audio/flac',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    wma: 'audio/x-ms-wma',
  };
  return playable(audio.canPlayType(types[format] ?? `audio/${format}`));
}

function testCanPlayMkv(video: HTMLVideoElement, browser: HelprrBrowser): boolean {
  if (playable(video.canPlayType('video/x-matroska')) || playable(video.canPlayType('video/mkv'))) {
    return true;
  }
  return browser.edgeChromium && browser.windows;
}

function canPlayNativeHlsInFmp4(browser: HelprrBrowser): boolean {
  return (browser.iOS && browser.iOSVersion >= 11) || browser.osx;
}

function supportsHdr10(browser: HelprrBrowser): boolean {
  return (browser.safari && ((browser.iOS && browser.iOSVersion >= 11) || browser.osx))
    || (browser.edgeChromium && browser.versionMajor >= 121)
    || (browser.chrome && !browser.mobile)
    || (browser.firefox && browser.osx && browser.versionMajor >= 100);
}

function supportsDolbyVision(browser: HelprrBrowser): boolean {
  return browser.safari && ((browser.iOS && browser.iOSVersion >= 13) || browser.osx);
}

function supportedDolbyVisionProfilesHevc(video: HTMLVideoElement): number[] {
  const profiles: number[] = [];
  if (playable(video.canPlayType('video/mp4; codecs="dvh1.05.06"'))) profiles.push(5);
  if (playable(video.canPlayType('video/mp4; codecs="dvh1.08.06"'))) profiles.push(8);
  return profiles;
}

function supportedDolbyVisionProfileAv1(video: HTMLVideoElement): boolean {
  return playable(video.canPlayType('video/mp4; codecs="dav1.10.06"'));
}

function physicalAudioChannels(options: DeviceProfileOptions, browser: HelprrBrowser): number {
  if (options.audioChannels && options.audioChannels > 0) return options.audioChannels;
  if (browser.mobile || browser.iOS) return 2;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      const ctx = new Ctx();
      const count = ctx.destination.maxChannelCount || 2;
      void ctx.close();
      return Math.min(Math.max(count, 2), 8);
    }
  } catch {
    // Ignore missing AudioContext.
  }
  return 6;
}

function canPlaySecondaryAudio(video: HTMLVideoElement): boolean {
  return typeof (video as HTMLVideoElement & { audioTracks?: unknown }).audioTracks !== 'undefined';
}

export function getDeviceProfile(options: DeviceProfileOptions = {}): JellyfinDeviceProfile {
  const browser = detectBrowser(options.userAgent, options.maxTouchPoints);
  const video = document.createElement('video');
  const bitrateSetting = options.maxStreamingBitrate ?? 120_000_000;
  const channels = physicalAudioChannels(options, browser);

  const canPlayVp8 = playable(video.canPlayType('video/webm; codecs="vp8"'));
  const canPlayVp9 = playable(video.canPlayType('video/webm; codecs="vp9"'));
  const safariSupportsOpus = browser.safari && browser.versionMajor >= 17
    && playable(document.createElement('audio').canPlayType('audio/x-caf; codecs="opus"'));
  const webmAudioCodecs = ['vorbis'];
  const canPlayMkv = testCanPlayMkv(video, browser);

  const profile: JellyfinDeviceProfile = {
    MaxStreamingBitrate: bitrateSetting,
    MaxStaticBitrate: 100_000_000,
    MusicStreamingTranscodingBitrate: Math.min(bitrateSetting, 384_000),
    DirectPlayProfiles: [],
    TranscodingProfiles: [],
    ContainerProfiles: [],
    CodecProfiles: [],
    SubtitleProfiles: [],
    ResponseProfiles: [{ Type: 'Video', Container: 'm4v', MimeType: 'video/mp4' }],
  };

  const supportsMp3VideoAudio = playable(video.canPlayType('video/mp4; codecs="avc1.640029, mp4a.69"'))
    || playable(video.canPlayType('video/mp4; codecs="avc1.640029, mp4a.6B"'))
    || playable(video.canPlayType('video/mp4; codecs="avc1.640029, mp3"'));

  let supportsMp2VideoAudio = false;
  if (supportsMp3VideoAudio && (browser.chrome || browser.edgeChromium || (browser.firefox && browser.versionMajor >= 83))) {
    supportsMp2VideoAudio = !browser.android;
  }

  const canPlayAacVideoAudio = playable(video.canPlayType('video/mp4; codecs="avc1.640029, mp4a.40.2"'));
  const canPlayMp3VideoAudioInHls = supportsMp3InHls(video);
  const canPlayAc3VideoAudio = supportsAc3(video, browser);
  const canPlayEac3VideoAudio = supportsEac3(video, browser);
  const canPlayAc3VideoAudioInHls = supportsAc3InHls(video);

  const videoAudioCodecs: string[] = [];
  const hlsInTsVideoAudioCodecs: string[] = [];
  const hlsInFmp4VideoAudioCodecs: string[] = [];

  if (canPlayAacVideoAudio) {
    videoAudioCodecs.push('aac');
    hlsInTsVideoAudioCodecs.push('aac');
    hlsInFmp4VideoAudioCodecs.push('aac');
  }
  if (supportsMp3VideoAudio) videoAudioCodecs.push('mp3');
  if (browser.safari || (supportsMp3VideoAudio)) hlsInTsVideoAudioCodecs.push('mp3');
  if (canPlayMp3VideoAudioInHls) hlsInFmp4VideoAudioCodecs.push('mp3');

  if (canPlayAc3VideoAudio) {
    videoAudioCodecs.push('ac3');
    if (browser.edgeChromium) hlsInFmp4VideoAudioCodecs.push('ac3');
    if (canPlayEac3VideoAudio) {
      videoAudioCodecs.push('eac3');
      if (browser.edgeChromium) hlsInFmp4VideoAudioCodecs.push('eac3');
    }
    if (canPlayAc3VideoAudioInHls) {
      hlsInTsVideoAudioCodecs.push('ac3');
      hlsInFmp4VideoAudioCodecs.push('ac3');
      if (canPlayEac3VideoAudio) {
        hlsInTsVideoAudioCodecs.push('eac3');
        hlsInFmp4VideoAudioCodecs.push('eac3');
      }
    }
  }

  if (supportsMp2VideoAudio) {
    videoAudioCodecs.push('mp2');
    hlsInTsVideoAudioCodecs.push('mp2');
    hlsInFmp4VideoAudioCodecs.push('mp2');
  }

  if (playable(video.canPlayType('video/mp4; codecs="dts-"')) || playable(video.canPlayType('video/mp4; codecs="dts+"'))) {
    videoAudioCodecs.push('dca', 'dts');
  }

  if (canPlayAudioFormat('opus', browser) || safariSupportsOpus) {
    videoAudioCodecs.push('opus');
    webmAudioCodecs.push('opus');
    hlsInFmp4VideoAudioCodecs.push('opus');
  }
  if (canPlayAudioFormat('flac', browser)) {
    videoAudioCodecs.push('flac');
    hlsInFmp4VideoAudioCodecs.push('flac');
  }
  if (canPlayAudioFormat('alac', browser)) {
    videoAudioCodecs.push('alac');
    hlsInFmp4VideoAudioCodecs.push('alac');
  }

  const mp4VideoCodecs: string[] = [];
  const webmVideoCodecs: string[] = [];
  const hlsInTsVideoCodecs: string[] = [];
  const hlsInFmp4VideoCodecs: string[] = [];

  if (canPlayAv1(video) && (browser.safari || (!browser.mobile && (browser.edgeChromium || browser.firefox || browser.chrome || browser.opera)))) {
    hlsInFmp4VideoCodecs.push('av1');
  }
  if (canPlayHevc(video, browser) && (
    browser.edgeChromium
    || browser.safari
    || (browser.chrome && (!browser.android || browser.versionMajor >= 105))
    || (browser.opera && !browser.mobile)
    || (browser.firefox && browser.versionMajor >= 134)
  )) {
    hlsInFmp4VideoCodecs.push('hevc');
  }
  if (canPlayH264(video)) {
    mp4VideoCodecs.push('h264');
    hlsInTsVideoCodecs.push('h264');
    hlsInFmp4VideoCodecs.push('h264');
  }
  if (canPlayHevc(video, browser)) mp4VideoCodecs.push('hevc');
  if (playable(video.canPlayType('video/mp4; codecs="vc-1"'))) mp4VideoCodecs.push('vc1');

  if (canPlayVp8) webmVideoCodecs.push('vp8');
  if (canPlayVp9) {
    if (!browser.iOS && !(browser.firefox && browser.osx)) mp4VideoCodecs.push('vp9');
    if (browser.safari || browser.edgeChromium || browser.chrome || browser.firefox) {
      hlsInFmp4VideoCodecs.push('vp9');
    }
    if (!browser.safari || (browser.safari && browser.versionMajor >= 15 && browser.versionMajor < 17)) {
      webmVideoCodecs.push('vp9');
    }
  }
  if (canPlayAv1(video)) {
    mp4VideoCodecs.push('av1');
    if (!browser.safari || (browser.safari && browser.versionMajor >= 15 && browser.versionMajor < 17)) {
      webmVideoCodecs.push('av1');
    }
  }

  if (!browser.safari && canPlayVp8) videoAudioCodecs.push('vorbis');

  if (webmVideoCodecs.length) {
    profile.DirectPlayProfiles.push({
      Container: 'webm',
      Type: 'Video',
      VideoCodec: webmVideoCodecs.join(','),
      AudioCodec: webmAudioCodecs.join(','),
    });
  }
  if (mp4VideoCodecs.length) {
    profile.DirectPlayProfiles.push({
      Container: 'mp4,m4v',
      Type: 'Video',
      VideoCodec: mp4VideoCodecs.join(','),
      AudioCodec: videoAudioCodecs.join(','),
    });
  }
  if (canPlayMkv && mp4VideoCodecs.length) {
    profile.DirectPlayProfiles.push({
      Container: 'mkv',
      Type: 'Video',
      VideoCodec: mp4VideoCodecs.join(','),
      AudioCodec: videoAudioCodecs.join(','),
    });
  }
  if (browser.safari || browser.chrome || browser.edgeChromium) {
    profile.DirectPlayProfiles.push({
      Container: 'mov',
      Type: 'Video',
      VideoCodec: 'h264',
      AudioCodec: videoAudioCodecs.join(','),
    });
  }

  for (const audioFormat of ['opus', 'mp3', 'mp2', 'aac', 'flac', 'alac', 'webma', 'wma', 'wav', 'ogg', 'oga']) {
    if (!canPlayAudioFormat(audioFormat, browser)) continue;
    if (audioFormat === 'mp3' && !canPlayMp3VideoAudioInHls) {
      profile.DirectPlayProfiles.push({ Container: 'ts', AudioCodec: 'mp3', Type: 'Audio' });
    }
    profile.DirectPlayProfiles.push({ Container: audioFormat, Type: 'Audio' });
    if (audioFormat === 'opus' || audioFormat === 'webma') {
      profile.DirectPlayProfiles.push({ Container: 'webm', AudioCodec: audioFormat, Type: 'Audio' });
    }
    if (audioFormat === 'aac' || audioFormat === 'alac') {
      profile.DirectPlayProfiles.push({ Container: 'm4a', AudioCodec: audioFormat, Type: 'Audio' });
      profile.DirectPlayProfiles.push({ Container: 'm4b', AudioCodec: audioFormat, Type: 'Audio' });
    }
  }
  if (safariSupportsOpus) {
    profile.DirectPlayProfiles.push({ Container: 'mp4', AudioCodec: 'opus', Type: 'Audio' });
  }

  const hlsBreakOnNonKeyFrames = browser.iOS || browser.osx || !canPlayNativeHls(video, browser);
  let enableFmp4Hls = true;
  if ((browser.safari || browser.iOS) && !canPlayNativeHlsInFmp4(browser)) {
    enableFmp4Hls = false;
  }

  if (canPlayHls(video, browser)) {
    profile.TranscodingProfiles.push({
      Container: enableFmp4Hls ? 'mp4' : 'ts',
      Type: 'Audio',
      AudioCodec: 'aac',
      Context: 'Streaming',
      Protocol: 'hls',
      MaxAudioChannels: String(channels),
      MinSegments: browser.iOS || browser.osx ? '2' : '1',
      BreakOnNonKeyFrames: hlsBreakOnNonKeyFrames,
      EnableAudioVbrEncoding: true,
    });
  }

  for (const audioFormat of ['aac', 'mp3', 'opus', 'wav'].filter((format) => canPlayAudioFormat(format, browser))) {
    profile.TranscodingProfiles.push({
      Container: audioFormat,
      Type: 'Audio',
      AudioCodec: audioFormat,
      Context: 'Streaming',
      Protocol: 'http',
      MaxAudioChannels: String(channels),
    });
  }

  if (canPlayHls(video, browser)) {
    if (hlsInFmp4VideoCodecs.length && hlsInFmp4VideoAudioCodecs.length && enableFmp4Hls) {
      profile.DirectPlayProfiles.push({
        Container: 'hls',
        Type: 'Video',
        VideoCodec: hlsInFmp4VideoCodecs.join(','),
        AudioCodec: hlsInFmp4VideoAudioCodecs.join(','),
      });
      profile.TranscodingProfiles.push({
        Container: 'mp4',
        Type: 'Video',
        AudioCodec: hlsInFmp4VideoAudioCodecs.join(','),
        VideoCodec: hlsInFmp4VideoCodecs.join(','),
        Context: 'Streaming',
        Protocol: 'hls',
        MaxAudioChannels: String(channels),
        MinSegments: browser.iOS || browser.osx ? '2' : '1',
        BreakOnNonKeyFrames: hlsBreakOnNonKeyFrames,
      });
    }
    if (hlsInTsVideoCodecs.length && hlsInTsVideoAudioCodecs.length) {
      profile.DirectPlayProfiles.push({
        Container: 'hls',
        Type: 'Video',
        VideoCodec: hlsInTsVideoCodecs.join(','),
        AudioCodec: hlsInTsVideoAudioCodecs.join(','),
      });
      profile.TranscodingProfiles.push({
        Container: 'ts',
        Type: 'Video',
        AudioCodec: hlsInTsVideoAudioCodecs.join(','),
        VideoCodec: hlsInTsVideoCodecs.join(','),
        Context: 'Streaming',
        Protocol: 'hls',
        MaxAudioChannels: String(channels),
        MinSegments: browser.iOS || browser.osx ? '2' : '1',
        BreakOnNonKeyFrames: hlsBreakOnNonKeyFrames,
      });
    }
  }

  const supportsSecondaryAudio = canPlaySecondaryAudio(video);
  const aacCodecProfileConditions: JellyfinDeviceProfileCondition[] = [];
  if (!playable(video.canPlayType('video/mp4; codecs="avc1.640029, mp4a.40.5"'))) {
    aacCodecProfileConditions.push({ Condition: 'NotEquals', Property: 'AudioProfile', Value: 'HE-AAC' });
  }
  if (!supportsSecondaryAudio) {
    aacCodecProfileConditions.push({
      Condition: 'Equals',
      Property: 'IsSecondaryAudio',
      Value: 'false',
      IsRequired: false,
    });
  }
  if (aacCodecProfileConditions.length) {
    profile.CodecProfiles.push({ Type: 'VideoAudio', Codec: 'aac', Conditions: aacCodecProfileConditions });
  }

  const globalVideoAudio: JellyfinDeviceProfileCondition[] = [
    { Condition: 'LessThanEqual', Property: 'AudioChannels', Value: String(channels), IsRequired: false },
  ];
  if (!supportsSecondaryAudio) {
    globalVideoAudio.push({
      Condition: 'Equals',
      Property: 'IsSecondaryAudio',
      Value: 'false',
      IsRequired: false,
    });
  }
  profile.CodecProfiles.push({ Type: 'Audio', Conditions: [
    { Condition: 'LessThanEqual', Property: 'AudioChannels', Value: String(channels), IsRequired: false },
  ] });
  profile.CodecProfiles.push({ Type: 'VideoAudio', Conditions: globalVideoAudio });

  if (safariSupportsOpus) {
    const opusConditions: JellyfinDeviceProfileCondition[] = [
      { Condition: 'LessThanEqual', Property: 'AudioChannels', Value: '2', IsRequired: false },
    ];
    profile.CodecProfiles.push({ Type: 'VideoAudio', Codec: 'opus', Conditions: opusConditions });
    const extra: JellyfinTranscodingProfile[] = [];
    for (const transcodingProfile of profile.TranscodingProfiles) {
      if (transcodingProfile.Type !== 'Video') continue;
      const audioCodecs = transcodingProfile.AudioCodec.split(',');
      if (!audioCodecs.includes('opus')) continue;
      extra.push({
        ...transcodingProfile,
        AudioCodec: 'opus',
        ApplyConditions: [...(transcodingProfile.ApplyConditions ?? []), ...opusConditions],
      });
      transcodingProfile.AudioCodec = audioCodecs.filter((codec) => codec !== 'opus').join(',');
    }
    profile.TranscodingProfiles.push(...extra);
  }

  let maxH264Level = 42;
  let h264Profiles = 'high|main|baseline|constrained baseline';
  if (playable(video.canPlayType('video/mp4; codecs="avc1.640833"'))) maxH264Level = 51;
  if (playable(video.canPlayType('video/mp4; codecs="avc1.640834"'))) maxH264Level = 52;
  if (
    playable(video.canPlayType('video/mp4; codecs="avc1.6e0033"'))
    && !browser.safari && !browser.iOS && !browser.mobile
  ) {
    h264Profiles += '|high 10';
  }

  let maxHevcLevel = 120;
  let hevcProfiles = 'main';
  if (playable(video.canPlayType('video/mp4; codecs="hvc1.1.4.L123"')) || playable(video.canPlayType('video/mp4; codecs="hev1.1.4.L123"'))) {
    maxHevcLevel = 123;
  }
  if (playable(video.canPlayType('video/mp4; codecs="hvc1.2.4.L123"')) || playable(video.canPlayType('video/mp4; codecs="hev1.2.4.L123"'))) {
    maxHevcLevel = 123;
    hevcProfiles = 'main|main 10';
  }
  if (playable(video.canPlayType('video/mp4; codecs="hvc1.2.4.L153"')) || playable(video.canPlayType('video/mp4; codecs="hev1.2.4.L153"'))) {
    maxHevcLevel = 153;
    hevcProfiles = 'main|main 10';
  }
  if (playable(video.canPlayType('video/mp4; codecs="hvc1.2.4.L183"')) || playable(video.canPlayType('video/mp4; codecs="hev1.2.4.L183"'))) {
    maxHevcLevel = 183;
    hevcProfiles = 'main|main 10';
  }

  let maxAv1Level = 15;
  if (playable(video.canPlayType('video/mp4; codecs="av01.0.16M.08"')) && playable(video.canPlayType('video/mp4; codecs="av01.0.16M.10"'))) maxAv1Level = 16;
  if (playable(video.canPlayType('video/mp4; codecs="av01.0.17M.08"')) && playable(video.canPlayType('video/mp4; codecs="av01.0.17M.10"'))) maxAv1Level = 17;
  if (playable(video.canPlayType('video/mp4; codecs="av01.0.18M.08"')) && playable(video.canPlayType('video/mp4; codecs="av01.0.18M.10"'))) maxAv1Level = 18;
  if (playable(video.canPlayType('video/mp4; codecs="av01.0.19M.08"')) && playable(video.canPlayType('video/mp4; codecs="av01.0.19M.10"'))) maxAv1Level = 19;

  let hevcVideoRangeTypes = 'SDR';
  let vp9VideoRangeTypes = 'SDR';
  let av1VideoRangeTypes = 'SDR';
  if (supportsHdr10(browser)) {
    hevcVideoRangeTypes += '|HDR10';
    vp9VideoRangeTypes += '|HDR10';
    av1VideoRangeTypes += '|HDR10';
    hevcVideoRangeTypes += '|HLG';
    vp9VideoRangeTypes += '|HLG';
    av1VideoRangeTypes += '|HLG';
  }
  if (supportsDolbyVision(browser)) {
    const dolby = supportedDolbyVisionProfilesHevc(video);
    if (dolby.includes(5)) hevcVideoRangeTypes += '|DOVI';
    if (dolby.includes(8)) hevcVideoRangeTypes += '|DOVIWithHDR10|DOVIWithHLG|DOVIWithSDR';
    if (supportedDolbyVisionProfileAv1(video)) {
      av1VideoRangeTypes += '|DOVI|DOVIWithHDR10|DOVIWithHLG|DOVIWithSDR';
    }
  }

  const notAnamorphic: JellyfinDeviceProfileCondition = {
    Condition: 'NotEquals',
    Property: 'IsAnamorphic',
    Value: 'true',
    IsRequired: false,
  };
  const notInterlaced: JellyfinDeviceProfileCondition = {
    Condition: 'NotEquals',
    Property: 'IsInterlaced',
    Value: 'true',
    IsRequired: false,
  };

  const h264CodecProfileConditions: JellyfinDeviceProfileCondition[] = [
    notAnamorphic,
    { Condition: 'EqualsAny', Property: 'VideoProfile', Value: h264Profiles, IsRequired: false },
    { Condition: 'EqualsAny', Property: 'VideoRangeType', Value: 'SDR', IsRequired: false },
    { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: String(maxH264Level), IsRequired: false },
    notInterlaced,
  ];
  const hevcCodecProfileConditions: JellyfinDeviceProfileCondition[] = [
    notAnamorphic,
    { Condition: 'EqualsAny', Property: 'VideoProfile', Value: hevcProfiles, IsRequired: false },
    { Condition: 'EqualsAny', Property: 'VideoRangeType', Value: hevcVideoRangeTypes, IsRequired: false },
    { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: String(maxHevcLevel), IsRequired: false },
    notInterlaced,
  ];
  const vp9CodecProfileConditions: JellyfinDeviceProfileCondition[] = [
    { Condition: 'EqualsAny', Property: 'VideoRangeType', Value: vp9VideoRangeTypes, IsRequired: false },
  ];
  const av1CodecProfileConditions: JellyfinDeviceProfileCondition[] = [
    notAnamorphic,
    { Condition: 'EqualsAny', Property: 'VideoProfile', Value: 'main', IsRequired: false },
    { Condition: 'EqualsAny', Property: 'VideoRangeType', Value: av1VideoRangeTypes, IsRequired: false },
    { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: String(maxAv1Level), IsRequired: false },
  ];

  const codecProfiles: JellyfinCodecProfile[] = [
    { Type: 'Video', Codec: 'h264', Conditions: h264CodecProfileConditions },
    { Type: 'Video', Codec: 'hevc', Conditions: hevcCodecProfileConditions },
    { Type: 'Video', Codec: 'vp9', Conditions: vp9CodecProfileConditions },
    { Type: 'Video', Codec: 'av1', Conditions: av1CodecProfileConditions },
  ];
  profile.CodecProfiles.push(...codecProfiles);

  if (typeof document !== 'undefined' && 'textTracks' in document.createElement('video')) {
    profile.SubtitleProfiles.push({ Format: 'vtt', Method: 'External' });
  }
  if (options.enableSsaRender !== false && !options.isRetry) {
    profile.SubtitleProfiles.push({ Format: 'ass', Method: 'External' });
    profile.SubtitleProfiles.push({ Format: 'ssa', Method: 'External' });
  }

  return profile;
}

export function bitrateOptions(): Array<{ label: string; value: number }> {
  return [
    { label: 'Auto', value: 0 },
    { label: '20 Mbps (1080p / 4K)', value: 20_000_000 },
    { label: '15 Mbps', value: 15_000_000 },
    { label: '10 Mbps (1080p)', value: 10_000_000 },
    { label: '8 Mbps', value: 8_000_000 },
    { label: '6 Mbps (720p)', value: 6_000_000 },
    { label: '4 Mbps', value: 4_000_000 },
    { label: '3 Mbps', value: 3_000_000 },
    { label: '1.5 Mbps (480p)', value: 1_500_000 },
    { label: '720 kbps', value: 720_000 },
  ];
}
