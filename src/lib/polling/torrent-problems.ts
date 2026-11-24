// QBT-12: a torrent that errors, finds its files missing, or stays stalled for
// too long. Each torrent's marks live in its qBittorrent polling-state entry
// (PollingState.lastQueueIds, saved every poll), so a push goes out once per
// time a torrent enters the state, and the marks reset when it leaves it.

const ERRORED_STATES = new Set(['error', 'missingFiles']);
// A download with no data (stalledDL), or a magnet still without its metadata
// (metaDL, forced or not: one nobody seeds never gets past it).
const STUCK_STATES = new Set(['stalledDL', 'metaDL', 'forcedMetaDL']);
// Passed through on the way back to the state it was in (a restart checks
// resume data, a recheck or move runs): the marks carry over unchanged, so a
// torrent still errored after a qBittorrent restart is not announced again.
const TRANSITIONAL_STATES = new Set(['checkingResumeData', 'checkingDL', 'checkingUP', 'moving', 'unknown']);

// A type, not an interface, so an entry stays assignable to Prisma's JSON input.
export type TorrentProblemMarks = {
  /** It was in error or missingFiles at the last poll. Absent on entries saved before QBT-12. */
  errored?: boolean;
  /** When a poll first saw this stall (epoch ms), or null while there is none. */
  stuckSince?: number | null;
  /** The stalled push for this stall went out. */
  stuckSent?: boolean;
  /** When it last left the stuck states during this stall (epoch ms), or null while stuck. */
  unstuckSince?: number | null;
};

export interface TorrentProblemResult {
  marks: Required<TorrentProblemMarks>;
  /** Send "Torrent Errored" now. */
  errored: boolean;
  /** Send "Torrent Stalled" now. */
  stalled: boolean;
}

const NO_STALL = { stuckSince: null, stuckSent: false, unstuckSince: null };

/**
 * The marks to save for one torrent, and which push is due. `previous` is its
 * entry from the last poll (undefined for a torrent new since then);
 * `firstRun` (no saved state at all) only records. An entry saved before
 * these marks existed records its state without a push too, so an upgrade
 * does not announce every torrent that was already errored.
 *
 * Before its push, any other state ends a stall (the time starts again).
 * After it, the stall ends only once the torrent has stayed out of the stuck
 * states for the stall time itself: a barely alive torrent that gets a moment
 * of data now and then gets one push, not one per burst.
 */
export function torrentProblems(
  state: string,
  previous: TorrentProblemMarks | undefined,
  options: { now: number; stalledAfterMs: number; firstRun: boolean },
): TorrentProblemResult {
  const { now, stalledAfterMs } = options;
  if (TRANSITIONAL_STATES.has(state) && previous) {
    return {
      marks: {
        errored: previous.errored ?? false,
        stuckSince: previous.stuckSince ?? null,
        stuckSent: previous.stuckSent ?? false,
        unstuckSince: previous.unstuckSince ?? null,
      },
      errored: false,
      stalled: false,
    };
  }

  const isErrored = ERRORED_STATES.has(state);
  const known = !options.firstRun && (previous === undefined || previous.errored !== undefined);
  const errored = isErrored && known && previous?.errored !== true;

  let stall: Omit<Required<TorrentProblemMarks>, 'errored'>;
  const ongoing = previous?.stuckSince != null;
  if (STUCK_STATES.has(state)) {
    stall = ongoing
      ? { stuckSince: previous!.stuckSince!, stuckSent: previous!.stuckSent === true, unstuckSince: null }
      : { ...NO_STALL, stuckSince: now };
  } else if (ongoing && previous!.stuckSent === true) {
    const unstuckSince = previous!.unstuckSince ?? now;
    stall = now - unstuckSince >= stalledAfterMs
      ? NO_STALL
      : { stuckSince: previous!.stuckSince!, stuckSent: true, unstuckSince };
  } else {
    stall = NO_STALL;
  }
  const stalled = stall.unstuckSince === null && stall.stuckSince !== null && !stall.stuckSent
    && now - stall.stuckSince >= stalledAfterMs;

  return {
    marks: { errored: isErrored, ...stall, stuckSent: stall.stuckSent || stalled },
    errored,
    stalled,
  };
}
