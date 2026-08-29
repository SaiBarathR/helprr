import { describe, expect, it } from 'vitest';
import { cueLineFor, positionToReport, reserveStart, subtitleNeedsOwnStream } from '@/components/jellyfin-streaming/playback-provider';
import type { HelprrStreamInfo } from '@/types/jellyfin-streaming';

/**
 * Cover for two defects found testing the player against a real Jellyfin
 * 10.11.11 library:
 *  - every subtitle change restarted the stream, where jellyfin-web swaps a
 *    text track on the element and only re-requests one for a burn-in;
 *  - the subtitle vertical-position setting did nothing, because the player
 *    chrome overwrote every cue's `line` on each cuechange.
 */

function streamWith(
  tracks: Array<{ index: number; deliveryMethod: string; format?: string }>,
  playMethod: HelprrStreamInfo['playMethod'] = 'DirectPlay',
): HelprrStreamInfo {
  return {
    playMethod,
    subtitleTracks: tracks.map((track) => ({
      index: track.index,
      url: track.deliveryMethod === 'Encode' ? '' : `/api/jellyfin/media/sub/${track.index}.vtt`,
      language: 'eng',
      displayTitle: `Track ${track.index}`,
      format: track.format ?? 'subrip',
      isDefault: false,
      isForced: false,
      isHearingImpaired: false,
      deliveryMethod: track.deliveryMethod,
    })),
  } as unknown as HelprrStreamInfo;
}

describe('subtitleNeedsOwnStream', () => {
  it('leaves the stream alone for an external text track', () => {
    const stream = streamWith([{ index: 2, deliveryMethod: 'External' }]);
    expect(subtitleNeedsOwnStream(stream, 2)).toBe(false);
  });

  it('requires a new stream for a track Jellyfin has to burn in', () => {
    // PGS on this library resolves to DeliveryMethod "Encode" with no delivery
    // URL: the only way to see it is a transcode that paints it in.
    const stream = streamWith([{ index: 5, deliveryMethod: 'Encode', format: 'pgssub' }]);
    expect(subtitleNeedsOwnStream(stream, 5)).toBe(true);
  });

  it('requires a new stream for an embedded track while transcoding', () => {
    const stream = streamWith([{ index: 3, deliveryMethod: 'Embed' }], 'Transcode');
    expect(subtitleNeedsOwnStream(stream, 3)).toBe(true);
  });

  it('plays an embedded track as-is when the stream is not transcoded', () => {
    const stream = streamWith([{ index: 3, deliveryMethod: 'Embed' }], 'DirectPlay');
    expect(subtitleNeedsOwnStream(stream, 3)).toBe(false);
  });

  it('treats off as needing nothing, so turning text subtitles off never restarts', () => {
    const stream = streamWith([{ index: 2, deliveryMethod: 'External' }]);
    expect(subtitleNeedsOwnStream(stream, -1)).toBe(false);
    expect(subtitleNeedsOwnStream(stream, null)).toBe(false);
  });

  it('ignores an index the source does not have', () => {
    const stream = streamWith([{ index: 2, deliveryMethod: 'External' }]);
    expect(subtitleNeedsOwnStream(stream, 99)).toBe(false);
  });
});

describe('cueLineFor', () => {
  it('passes a positive position straight through', () => {
    expect(cueLineFor(3, 'one line')).toBe(3);
  });

  it('lifts a multi-line cue so its last line lands where a single line would', () => {
    expect(cueLineFor(-3, 'first\nsecond')).toBe(-4);
    expect(cueLineFor(-3, 'first\nsecond\nthird')).toBe(-5);
  });

  it('leaves a single-line cue at the requested position', () => {
    expect(cueLineFor(-3, 'just the one')).toBe(-3);
  });
});

describe('positionToReport', () => {
  const stream = { startTimeTicks: 12_000_000_000 } as unknown as HelprrStreamInfo;
  const element = (currentTime: number) => ({ currentTime }) as HTMLMediaElement;

  it('reports where the stream was started while the element is still at zero', () => {
    // A restarted HLS transcode attaches at 0 and only jumps to the offset once
    // hls.js has the level details. Reporting that zero writes it straight to
    // the member's resume point.
    expect(positionToReport(element(0), stream, false)).toBe(12_000_000_000);
  });

  it('reports the element once it has actually arrived', () => {
    expect(positionToReport(element(1225), stream, true)).toBe(12_250_000_000);
  });

  it('lets a real seek back to the start be reported', () => {
    expect(positionToReport(element(0), stream, true)).toBe(0);
  });
});

describe('reserveStart', () => {
  it('lets only the newest claim through', () => {
    const token = { current: 0 };
    const first = reserveStart(token);
    const second = reserveStart(token);
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  /**
   * The ASS/PGS defect, in the shape it actually happens.
   *
   * A restart is stop-then-start and the stop is a network round trip, so three
   * quick subtitle clicks all enter the restart holding the same live session.
   * With the claim taken only after the stop, whichever stop the server
   * answered *last* was the one that started — so an earlier click could
   * supersede the viewer's final one. The claim is taken in click order now, so
   * out-of-order stops cannot change which selection reaches the player.
   */
  it('starts the last click even when the stops answer out of order', async () => {
    const token = { current: 0 };
    const started: string[] = [];
    const stops: Array<() => void> = [];

    const restart = async (choice: string) => {
      const stillCurrent = reserveStart(token);
      await new Promise<void>((resolve) => stops.push(resolve));
      if (!stillCurrent()) return;
      started.push(choice);
    };

    const chains = [restart('pgs'), restart('ass'), restart('pgs-again')];
    // The server answers the middle click's stop first and the last click's
    // second, which is exactly the ordering that used to invert the result.
    stops[1]();
    stops[2]();
    stops[0]();
    await Promise.all(chains);

    expect(started).toEqual(['pgs-again']);
  });
});
