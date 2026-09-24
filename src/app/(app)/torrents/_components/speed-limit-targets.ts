export interface SpeedLimitTarget {
  hash: string;
  name: string;
  dl_limit: number;
  up_limit: number;
}

// The list hands its selection to /torrents/speed-limits in memory: a selection
// can hold hundreds of 40-character hashes, more than a URL safely carries.
// After a reload the page finds none and says so.
let targets: SpeedLimitTarget[] = [];

export function setSpeedLimitTargets(next: SpeedLimitTarget[]): void {
  targets = next;
}

export function getSpeedLimitTargets(): SpeedLimitTarget[] {
  return targets;
}
