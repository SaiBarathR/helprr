import { describe, expect, it } from 'vitest';
import { mediaBadges } from '@/lib/jellyfin-playback/media-badges';
import type { JellyfinMediaStream } from '@/types/jellyfin';

const video = (props: Partial<JellyfinMediaStream>): JellyfinMediaStream =>
  ({ Type: 'Video', ...props }) as JellyfinMediaStream;
const audio = (props: Partial<JellyfinMediaStream>): JellyfinMediaStream =>
  ({ Type: 'Audio', ...props }) as JellyfinMediaStream;
const subtitle = (): JellyfinMediaStream => ({ Type: 'Subtitle' }) as JellyfinMediaStream;

/**
 * The badge row used to be two booleans — `Height >= 700` for "HD" and "any
 * subtitle" for "CC" — so a 4K HDR title with an Atmos mix advertised itself as
 * "HD CC", exactly like a stereo 720p one. Values here are the ones this
 * library actually reports.
 */
describe('mediaBadges', () => {
  it('calls 2160p 4K rather than HD', () => {
    expect(mediaBadges([video({ Width: 3840, Height: 2160 })]).resolution).toBe('4K');
  });

  it('reads width, so a scope-ratio 4K master is not demoted', () => {
    // 3840x1600 is shorter than a 1080p frame; height alone called this HD.
    expect(mediaBadges([video({ Width: 3840, Height: 1600 })]).resolution).toBe('4K');
  });

  it('still calls cropped 1080p transfers HD', () => {
    // Both heights are present in this library.
    expect(mediaBadges([video({ Width: 1920, Height: 1040 })]).resolution).toBe('HD');
    expect(mediaBadges([video({ Width: 1920, Height: 1074 })]).resolution).toBe('HD');
  });

  it('gives standard definition no badge at all', () => {
    expect(mediaBadges([video({ Width: 720, Height: 480 })]).resolution).toBeNull();
  });

  it.each([
    ['DOVI', 'Dolby Vision'],
    ['DOVIWithHDR10', 'Dolby Vision'],
    ['DOVIWithHLG', 'Dolby Vision'],
    // Observed on this library's own copy of 2001. Not a value guessed from
    // the enum — and the reason this matches by substring rather than by a
    // list, which would have quietly downgraded it to plain "HDR".
    ['DOVIWithEL', 'Dolby Vision'],
    ['HDR10Plus', 'HDR10+'],
    ['HDR10', 'HDR10'],
    ['HLG', 'HLG'],
  ])('maps VideoRangeType %s to %s', (type, expected) => {
    expect(mediaBadges([video({ VideoRangeType: type })]).dynamicRange).toBe(expected);
  });

  it('leaves SDR and unscanned files unlabelled', () => {
    expect(mediaBadges([video({ VideoRangeType: 'SDR' })]).dynamicRange).toBeNull();
    expect(mediaBadges([video({ VideoRangeType: 'Unknown' })]).dynamicRange).toBeNull();
    expect(mediaBadges([video({})]).dynamicRange).toBeNull();
  });

  it('falls back to VideoRange when an older scan left the type empty', () => {
    expect(mediaBadges([video({ VideoRange: 'HDR' })]).dynamicRange).toBe('HDR');
  });

  it.each([
    ['DolbyAtmos', 'Atmos'],
    ['DTSX', 'DTS:X'],
  ])('reports %s as %s', (format, expected) => {
    expect(mediaBadges([audio({ AudioSpatialFormat: format, ChannelLayout: '7.1' })]).audio).toBe(expected);
  });

  it('prefers a spatial format over the channel count it rides on', () => {
    const badges = mediaBadges([
      audio({ ChannelLayout: '5.1', Channels: 6 }),
      audio({ AudioSpatialFormat: 'DolbyAtmos', ChannelLayout: '7.1', Channels: 8 }),
    ]);
    expect(badges.audio).toBe('Atmos');
  });

  it('describes the best track, so a stereo commentary cannot talk a title down', () => {
    const badges = mediaBadges([
      audio({ ChannelLayout: 'stereo', Channels: 2 }),
      audio({ ChannelLayout: '5.1', Channels: 6 }),
    ]);
    expect(badges.audio).toBe('5.1');
  });

  it('trusts ChannelLayout over Channels for side/back variants', () => {
    expect(mediaBadges([audio({ ChannelLayout: '5.1(side)', Channels: 6 })]).audio).toBe('5.1');
    expect(mediaBadges([audio({ ChannelLayout: '7.1', Channels: 8 })]).audio).toBe('7.1');
  });

  it('gives stereo no badge', () => {
    expect(mediaBadges([audio({ ChannelLayout: 'stereo', Channels: 2 })]).audio).toBeNull();
  });

  it('flags subtitles only when a track exists', () => {
    expect(mediaBadges([video({}), subtitle()]).subtitles).toBe(true);
    expect(mediaBadges([video({})]).subtitles).toBe(false);
  });

  it('badges the owner\'s Dolby Vision copy of 2001 correctly', () => {
    // 3840x2160 DOVIWithEL 10-bit HEVC, ac3 + eac3 5.1, four subtitle tracks.
    expect(mediaBadges([
      video({ Width: 3840, Height: 2160, VideoRangeType: 'DOVIWithEL', VideoRange: 'HDR', Codec: 'hevc', BitDepth: 10 }),
      audio({ Codec: 'ac3', ChannelLayout: '5.1', Channels: 6, AudioSpatialFormat: 'None' }),
      audio({ Codec: 'eac3', ChannelLayout: '5.1', Channels: 6, AudioSpatialFormat: 'None' }),
      subtitle(),
    ])).toEqual({ resolution: '4K', dynamicRange: 'Dolby Vision', audio: '5.1', subtitles: true });
  });

  it('picks Atmos out of the owner\'s Gravity, past a DTS 7.1 sitting first', () => {
    // 3840x2160 SDR, and the Atmos track is the *second* of three.
    expect(mediaBadges([
      video({ Width: 3840, Height: 2160, VideoRangeType: 'SDR', Codec: 'hevc' }),
      audio({ Codec: 'dts', ChannelLayout: '7.1', Channels: 8, AudioSpatialFormat: 'None', Profile: 'DTS-HD MA' }),
      audio({ Codec: 'truehd', ChannelLayout: '7.1', Channels: 8, AudioSpatialFormat: 'DolbyAtmos', Profile: 'Dolby TrueHD + Dolby Atmos' }),
      audio({ Codec: 'ac3', ChannelLayout: '5.1', Channels: 6, AudioSpatialFormat: 'None' }),
      subtitle(),
    ])).toEqual({ resolution: '4K', dynamicRange: null, audio: 'Atmos', subtitles: true });
  });

  it('describes this library\'s real 4K title the way the file actually is', () => {
    // (500) Days of Summer: 2160p SDR HEVC with a single 5.1 AAC track. It
    // showed "HD CC" before.
    const badges = mediaBadges([
      video({ Width: 3840, Height: 2160, VideoRangeType: 'SDR', Codec: 'hevc' }),
      audio({ Codec: 'aac', ChannelLayout: '5.1', Channels: 6, AudioSpatialFormat: 'None' }),
      subtitle(),
    ]);
    expect(badges).toEqual({
      resolution: '4K',
      dynamicRange: null,
      audio: '5.1',
      subtitles: true,
    });
  });
});
