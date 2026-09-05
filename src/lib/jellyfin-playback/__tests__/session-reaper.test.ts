import { beforeEach, describe, expect, it } from 'vitest';
import {
  SILENCE_MS,
  notePlaybackReport,
  selectSilentSessions,
  trackedSessionCount,
  __resetReaperForTests,
  type TrackedPlayback,
} from '@/lib/jellyfin-playback/session-reaper';

/**
 * Cover for playback sessions outliving the app that started them.
 *
 * Measured against a real server: fourteen minutes after an iOS PWA was killed
 * from the app switcher, the Jellyfin session was still listed, the transcode
 * was still running, and the resume point had been dragged eleven minutes past
 * where the viewer stopped. iOS fires no lifecycle event on termination, so the
 * client's own reports going quiet is the only signal there is.
 */

const REPORT = {
  event: 'progress' as const,
  userId: 'user-1',
  deviceId: 'helprr-pwa-aaa',
  deviceName: 'Helprr iPhone',
  itemId: 'item-1',
  playSessionId: 'play-1',
  positionTicks: 1_000,
};

function session(overrides: Partial<TrackedPlayback> = {}): TrackedPlayback {
  return {
    userId: 'user-1',
    deviceId: 'helprr-pwa-aaa',
    deviceName: 'Helprr iPhone',
    itemId: 'item-1',
    playSessionId: 'play-1',
    positionTicks: 0,
    lastReportAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  __resetReaperForTests();
});

describe('selectSilentSessions', () => {
  it('leaves a session that reported within the window alone', () => {
    const now = 1_000_000;
    const recent = session({ lastReportAt: now - (SILENCE_MS - 1) });
    expect(selectSilentSessions([recent], now)).toEqual([]);
  });

  it('picks up a session that has gone quiet for the whole window', () => {
    const now = 1_000_000;
    const quiet = session({ lastReportAt: now - SILENCE_MS });
    expect(selectSilentSessions([quiet], now)).toEqual([quiet]);
  });

  it('tolerates a paused client, which keeps reporting', () => {
    // Pausing does not stop the progress timer, so a paused player is still
    // heard from every ten seconds and must never be mistaken for a dead one.
    const now = 1_000_000;
    const paused = session({ lastReportAt: now - 10_000 });
    expect(selectSilentSessions([paused], now)).toEqual([]);
  });

  it('separates a dead session from a live one on the same sweep', () => {
    const now = 1_000_000;
    const dead = session({ playSessionId: 'play-dead', lastReportAt: now - SILENCE_MS * 2 });
    const live = session({ playSessionId: 'play-live', lastReportAt: now - 5_000 });
    expect(selectSilentSessions([dead, live], now).map((s) => s.playSessionId)).toEqual(['play-dead']);
  });
});

describe('notePlaybackReport', () => {
  it('starts watching a session when the player reports playing', () => {
    notePlaybackReport({ ...REPORT, event: 'playing' });
    expect(trackedSessionCount()).toBe(1);
  });

  it('stops watching once the player says it stopped', () => {
    notePlaybackReport({ ...REPORT, event: 'playing' });
    notePlaybackReport({ ...REPORT, event: 'stopped' });
    expect(trackedSessionCount()).toBe(0);
  });

  it('keeps one entry per play session rather than one per report', () => {
    notePlaybackReport({ ...REPORT, event: 'playing' });
    notePlaybackReport({ ...REPORT, event: 'progress', positionTicks: 2_000 });
    notePlaybackReport({ ...REPORT, event: 'progress', positionTicks: 3_000 });
    expect(trackedSessionCount()).toBe(1);
  });

  it('keeps only the newest play session for a device', () => {
    // Changing a track starts a new play session and never reports Stopped for
    // the old one. Two entries for one device would let a later sweep send a
    // Stopped carrying the superseded id, which Jellyfin resolves to the device
    // and would use to clear whatever is actually playing on it.
    notePlaybackReport({ ...REPORT, event: 'playing', playSessionId: 'play-1' });
    notePlaybackReport({ ...REPORT, event: 'playing', playSessionId: 'play-2' });
    expect(trackedSessionCount()).toBe(1);
  });

  it('tracks a second device separately', () => {
    notePlaybackReport({ ...REPORT, event: 'playing' });
    notePlaybackReport({
      ...REPORT,
      event: 'playing',
      deviceId: 'helprr-pwa-bbb',
      playSessionId: 'play-2',
    });
    expect(trackedSessionCount()).toBe(2);
  });

  it('ignores a report with no play session, which nothing could be stopped by', () => {
    notePlaybackReport({ ...REPORT, event: 'playing', playSessionId: undefined });
    expect(trackedSessionCount()).toBe(0);
  });
});
