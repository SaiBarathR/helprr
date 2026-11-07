export interface OrganizeTarget {
  hash: string;
  name: string;
  save_path: string;
  tags: string;
}

// The list hands its selection to /torrents/organize in memory, like the bulk
// speed limits: a selection can hold more hashes than a URL safely carries.
// After a reload the page finds none and says so.
let targets: OrganizeTarget[] = [];

export function setOrganizeTargets(next: OrganizeTarget[]): void {
  targets = next;
}

export function getOrganizeTargets(): OrganizeTarget[] {
  return targets;
}
