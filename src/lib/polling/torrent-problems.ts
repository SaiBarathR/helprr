// QBT-12: a torrent that errors, finds its files missing, or stays stalled for
// too long. Each torrent's marks live in its qBittorrent polling-state entry
// (PollingState.lastQueueIds, saved every poll), so a push goes out once per
// time a torrent enters the state, and the marks reset when it leaves it.

const ERRORED_STATES = new Set(['error', 'missingFiles']);
// A download with no data (stalledDL), or a magnet still without its metadata
// (metaDL, forced or not: one nobody seeds never gets past it).
const STUCK_STATES = new Set(['stalledDL', 'metaDL', 'forcedMetaDL']);

// A type, not an interface, so an entry stays assignable to Prisma's JSON input.
export type TorrentProblemMarks = {
  /** It was in error or missingFiles at the last poll. Absent on entries saved before QBT-12. */
  errored?: boolean;
  /** When a poll first saw it stuck (epoch ms), or null while it is not. */
  stuckSince?: number | null;
  /** The stalled push for this stall went out. */
  stuckSent?: boolean;
};

export interface TorrentProblemResult {
  marks: Required<TorrentProblemMarks>;
  /** Send "Torrent Errored" now. */
  errored: boolean;
  /** Send "Torrent Stalled" now. */
  stalled: boolean;
}

/**
 * The marks to save for one torrent, and which push is due. `previous` is its
 * entry from the last poll (undefined for a torrent new since then);
 * `firstRun` (no saved state at all) only records. An entry saved before
 * these marks existed records its state without a push too, so an upgrade
 * does not announce every torrent that was already errored.
 */
export function torrentProblems(
  state: string,
  previous: TorrentProblemMarks | undefined,
  options: { now: number; stalledAfterMs: number; firstRun: boolean },
): TorrentProblemResult {
  const isErrored = ERRORED_STATES.has(state);
  const isStuck = STUCK_STATES.has(state);
  const known = !options.firstRun && (previous === undefined || previous.errored !== undefined);
  const errored = isErrored && known && previous?.errored !== true;

  const stuckSince = isStuck ? previous?.stuckSince ?? options.now : null;
  const alreadySent = isStuck && previous?.stuckSent === true;
  const stalled = isStuck && !alreadySent && stuckSince !== null && options.now - stuckSince >= options.stalledAfterMs;

  return {
    marks: { errored: isErrored, stuckSince, stuckSent: alreadySent || stalled },
    errored,
    stalled,
  };
}
