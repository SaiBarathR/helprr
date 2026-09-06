import { logger } from '@/lib/logger';
import { prisma } from '@/lib/db';
import { getJellyfinPlaybackContext } from '@/lib/service-helpers';

const LOG = 'playback-session-reaper';

/**
 * Ending playback sessions whose client never got to say goodbye.
 *
 * The player reports Stopped from `pagehide`, which covers a closed tab and a
 * navigation away. It does not cover an app being killed: iOS fires no
 * lifecycle event at all when a standalone PWA is terminated from the app
 * switcher, so no JavaScript runs and nothing is sent. Measured against a real
 * server, the consequences of that are not cosmetic — fourteen minutes after
 * the app died the Jellyfin session was still listed, the transcode was still
 * running at 28fps, and the title's resume point had been dragged eleven
 * minutes past where the viewer actually stopped watching.
 *
 * Jellyfin cannot notice on its own: it keeps its own `LastPlaybackCheckIn`
 * moving while a transcode lives, so the session looks alive from its side.
 * The client's own reports are the only real liveness signal, and they arrive
 * here, so this is where a missing one has to be noticed.
 */

/**
 * How long a session may go unreported before it is treated as gone.
 *
 * The player reports every 10s while playing *or* paused, so this is twelve
 * missed reports. It is deliberately generous: a backgrounded PWA that is
 * legitimately still playing audio has its timers throttled by the OS, and
 * reaping one of those would stop music the viewer is listening to. Being a
 * couple of minutes late to clear a ghost is a much smaller harm.
 */
export const SILENCE_MS = 120_000;

const SWEEP_MS = 30_000;

/**
 * How quiet a session must be before a restarting device may claim it.
 *
 * A device id is shared by every tab in a browser profile, so "this device has
 * a session" is not on its own proof that the session is abandoned — opening a
 * second tab while the first one plays must not stop the first. A live player
 * reports every ten seconds, so anything silent for this long is not one, and
 * the margin is wide enough to survive a slow report.
 *
 * The cost is that killing the app and immediately reopening it lands inside
 * the window and clears nothing; the sweep picks that case up on its own
 * schedule instead. Clearing a ghost late is a much smaller harm than stopping
 * a viewer's playback in another tab.
 */
const RESTART_QUIET_MS = 25_000;

export interface TrackedPlayback {
  userId: string;
  deviceId: string;
  deviceName: string;
  itemId: string;
  mediaSourceId?: string;
  playSessionId: string;
  positionTicks: number;
  /** Epoch ms of the last report the client sent for this session. */
  lastReportAt: number;
}

/**
 * Which tracked sessions have gone quiet for too long.
 *
 * Split out from the sweep so the rule can be tested without a Jellyfin.
 */
export function selectSilentSessions(
  sessions: Iterable<TrackedPlayback>,
  now: number,
  silenceMs: number = SILENCE_MS,
): TrackedPlayback[] {
  return [...sessions].filter((session) => now - session.lastReportAt >= silenceMs);
}

interface ReaperState {
  sessions: Map<string, TrackedPlayback>;
  timer: NodeJS.Timeout | null;
  sweeping: boolean;
}

// Stashed on globalThis so Next's dev hot-reload re-importing this module does
// not lose the tracked sessions or stack a second timer, the same guard the
// cleanup scheduler uses. In-memory only: a Helprr restart forgets what it was
// tracking, and sessions orphaned across that restart have to wait for
// Jellyfin's own timeout.
const globalState = globalThis as unknown as { __helprrPlaybackReaper?: ReaperState };
const state: ReaperState = globalState.__helprrPlaybackReaper ??= {
  sessions: new Map(),
  timer: null,
  sweeping: false,
};

/** Visible to the reaper's tests; not part of the module's contract. */
export function __resetReaperForTests() {
  state.sessions.clear();
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.sweeping = false;
}

export function trackedSessionCount(): number {
  return state.sessions.size;
}

/**
 * Record that a client is still there, or that it has stopped on its own.
 *
 * Called for every report the player sends. A Stopped report is the client
 * doing the right thing, so the session simply stops being watched.
 */
export function notePlaybackReport(report: {
  event: 'playing' | 'progress' | 'stopped';
  userId: string;
  deviceId: string;
  deviceName?: string;
  itemId: string;
  mediaSourceId?: string;
  playSessionId?: string;
  positionTicks?: number;
}): void {
  if (!report.playSessionId) return;
  if (report.event === 'stopped') {
    state.sessions.delete(report.playSessionId);
    return;
  }
  // One session per device. Changing a track or picking another episode starts
  // a new play session without reporting Stopped for the old one, so entries
  // would otherwise pile up per device — and a later sweep would then send a
  // Stopped carrying a superseded playSessionId, which Jellyfin resolves to the
  // device and would use to clear the playback actually running on it.
  for (const [key, tracked] of state.sessions) {
    if (tracked.deviceId === report.deviceId && key !== report.playSessionId) {
      state.sessions.delete(key);
    }
  }
  state.sessions.set(report.playSessionId, {
    userId: report.userId,
    deviceId: report.deviceId,
    deviceName: report.deviceName ?? 'Helprr',
    itemId: report.itemId,
    mediaSourceId: report.mediaSourceId,
    playSessionId: report.playSessionId,
    positionTicks: report.positionTicks ?? 0,
    lastReportAt: Date.now(),
  });
}

/**
 * Tell Jellyfin the session ended, and release the encoder behind it.
 *
 * Sends exactly what the client would have sent, signed with the same member's
 * token, so the session closes attributed to them and the resume point lands
 * where playback actually reached rather than wherever the abandoned transcode
 * wandered to.
 */
async function endSession(session: TrackedPlayback, reason: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, role: true, jellyfinUserId: true, jellyfinToken: true },
  });
  if (!user) return;

  const { client } = await getJellyfinPlaybackContext(user);
  await client.reportPlayback({
    event: 'stopped',
    deviceId: session.deviceId,
    deviceName: session.deviceName,
    itemId: session.itemId,
    mediaSourceId: session.mediaSourceId,
    playSessionId: session.playSessionId,
    positionTicks: session.positionTicks,
    isPaused: true,
  });
  await client.stopActiveEncodings(session.playSessionId, session.deviceId, session.deviceName);
  logger.info('Ended an abandoned playback session', {
    reason,
    deviceName: session.deviceName,
    itemId: session.itemId,
  }, { scope: LOG });
}

async function endAll(sessions: TrackedPlayback[], reason: string): Promise<number> {
  let ended = 0;
  for (const session of sessions) {
    // Dropped from tracking first: a stop that fails must not be retried every
    // sweep forever against a Jellyfin that has already forgotten the session.
    state.sessions.delete(session.playSessionId);
    try {
      await endSession(session, reason);
      ended += 1;
    } catch (error) {
      logger.warn('Could not end an abandoned playback session', {
        reason,
        itemId: session.itemId,
        error: error instanceof Error ? error.message : String(error),
      }, { scope: LOG });
    }
  }
  return ended;
}

/**
 * Stop whatever this device left behind.
 *
 * Called when the app starts and finds itself with nothing playing: if the
 * device is still holding a session, the previous run of the app was killed
 * rather than closed. A session that is still reporting is left alone, which is
 * what keeps this from stopping a second tab that shares the same device id.
 */
export async function reapDeviceSessions(deviceId: string): Promise<number> {
  const now = Date.now();
  const stale = [...state.sessions.values()].filter(
    (session) => session.deviceId === deviceId && now - session.lastReportAt >= RESTART_QUIET_MS,
  );
  logger.debug('Device asked for its abandoned sessions', {
    deviceId,
    tracked: state.sessions.size,
    ages: [...state.sessions.values()]
      .filter((s) => s.deviceId === deviceId)
      .map((s) => ({ play: s.playSessionId.slice(0, 8), ageMs: now - s.lastReportAt })),
    stale: stale.length,
  }, { scope: LOG });
  return endAll(stale, 'device restarted');
}

async function sweep(): Promise<void> {
  if (state.sweeping) return;
  state.sweeping = true;
  try {
    const silent = selectSilentSessions(state.sessions.values(), Date.now());
    if (silent.length > 0) await endAll(silent, 'client stopped reporting');
  } catch (error) {
    logger.error('Playback session sweep failed', {
      error: error instanceof Error ? error.message : String(error),
    }, { scope: LOG });
  } finally {
    state.sweeping = false;
  }
}

export function startPlaybackSessionReaper(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => void sweep(), SWEEP_MS);
  state.timer.unref();
}

export function stopPlaybackSessionReaper(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}
