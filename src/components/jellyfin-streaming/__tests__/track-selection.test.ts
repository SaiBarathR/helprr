import { describe, expect, it } from 'vitest';
import { applyCueLine, cueLineFor, positionToReport, reserveStart, subtitleNeedsOwnStream, waitForLayout } from '@/components/jellyfin-streaming/playback-provider';
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

/**
 * Cue placement against the player chrome.
 *
 * Row counting alone put the seek bar through the last line of a cue on a
 * phone: the reserved rows are text-sized, the chrome is pixel-sized, and on a
 * 426x876 viewport they disagree. These pin the two placement modes and the
 * switch between them.
 */
describe('applyCueLine', () => {
  interface FakeCue { text: string; line: number | 'auto'; snapToLines: boolean; lineAlign: string }

  /** A cue list shaped like the bits of TextTrack/VTTCue this writer touches. */
  function trackOf(texts: string[], opts: { lineAlign?: boolean } = {}): { track: TextTrack; cues: FakeCue[] } {
    const cues = texts.map((text) => {
      const cue: FakeCue = { text, line: 'auto', snapToLines: true, lineAlign: 'start' };
      if (opts.lineAlign === false) {
        // A UA that does not implement lineAlign: the setter never sticks.
        Object.defineProperty(cue, 'lineAlign', { get: () => 'start', set: () => {} });
      }
      return cue;
    });
    return { track: { cues } as unknown as TextTrack, cues };
  }

  it('counts rows from the bottom while the chrome is down', () => {
    const { track, cues } = trackOf(['one line', 'first\nsecond']);
    applyCueLine(track, -3, 0, 876);
    expect(cues.map((c) => [c.snapToLines, c.lineAlign, c.line]))
      .toEqual([[true, 'start', -3], [true, 'start', -4]]);
  });

  it('anchors the box bottom to the top of the chrome while it is up', () => {
    const { track, cues } = trackOf(['one line', 'first\nsecond']);
    applyCueLine(track, -3, 101, 876);
    // 101px of 876 covered, so the box's bottom edge sits at 88.47%.
    for (const cue of cues) {
      expect(cue.snapToLines).toBe(false);
      expect(cue.lineAlign).toBe('end');
      expect(cue.line).toBeCloseTo(((876 - 101) / 876) * 100, 4);
    }
  });

  it('places every cue identically regardless of line count, which is the point', () => {
    // Row placement had to guess how tall the box would be, and guessed from
    // newlines — so a cue that wrapped landed lower than the rows reserved for
    // it. An end-anchored box grows upward instead.
    const { track, cues } = trackOf(['a', 'a\nb', 'a\nb\nc']);
    applyCueLine(track, -3, 101, 876);
    expect(new Set(cues.map((c) => c.line)).size).toBe(1);
  });

  it('falls back to rows when the UA ignores lineAlign', () => {
    // Without lineAlign a percentage line anchors the box top, which would push
    // it further into the chrome — strictly worse than the rows it replaced.
    const { track, cues } = trackOf(['first\nsecond'], { lineAlign: false });
    applyCueLine(track, -3, 101, 876);
    expect(cues[0].snapToLines).toBe(true);
    expect(cues[0].line).toBe(-4);
  });

  it('restores row placement when the chrome goes away again', () => {
    const { track, cues } = trackOf(['first\nsecond']);
    applyCueLine(track, -3, 101, 876);
    applyCueLine(track, -3, 0, 876);
    expect(cues[0]).toMatchObject({ snapToLines: true, lineAlign: 'start', line: -4 });
  });

  it('does nothing to a track with no cues yet', () => {
    expect(() => applyCueLine({ cues: null } as unknown as TextTrack, -3, 101, 876)).not.toThrow();
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

/**
 * libass measures the element it is handed and aborts with "width or height is
 * 0" on a zero-sized one. Subtitles are applied from attachMedia before
 * playSafely, so on iOS — where native HLS attaches faster than the stage
 * paints — every ASS track was dropped, silently, by the onError handler.
 */
describe('waitForLayout', () => {
  const sizedElement = (width: number, height: number) =>
    ({ clientWidth: width, clientHeight: height }) as unknown as HTMLElement;

  /** Captures the callback so a test can drive a resize itself. */
  function stubResizeObserver() {
    const original = globalThis.ResizeObserver;
    const instances: { cb: () => void; disconnected: boolean }[] = [];
    class Stub {
      cb: () => void;
      disconnected = false;
      constructor(cb: () => void) { this.cb = cb; instances.push(this); }
      observe() { /* the test calls cb directly */ }
      disconnect() { this.disconnected = true; }
    }
    globalThis.ResizeObserver = Stub as unknown as typeof ResizeObserver;
    return { instances, restore: () => { globalThis.ResizeObserver = original; } };
  }

  it('resolves without observing when the element already has a box', async () => {
    const { instances, restore } = stubResizeObserver();
    try {
      await waitForLayout(sizedElement(402, 226));
      expect(instances).toHaveLength(0);
    } finally { restore(); }
  });

  it('waits for the element to gain a box, then stops observing', async () => {
    const { instances, restore } = stubResizeObserver();
    try {
      const el = sizedElement(0, 0) as { clientWidth: number; clientHeight: number };
      const pending = waitForLayout(el as unknown as HTMLElement, 5_000);
      expect(instances).toHaveLength(1);

      // A resize that leaves it zero-sized must not resolve it.
      instances[0].cb();
      el.clientWidth = 402;
      el.clientHeight = 226;
      instances[0].cb();

      await pending;
      expect(instances[0].disconnected).toBe(true);
    } finally { restore(); }
  });

  it('gives up after the timeout rather than stalling playback', async () => {
    const { instances, restore } = stubResizeObserver();
    try {
      await waitForLayout(sizedElement(0, 0), 1);
      expect(instances[0].disconnected).toBe(true);
    } finally { restore(); }
  });
});
