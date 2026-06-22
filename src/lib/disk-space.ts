import type { DiskSpace } from '@/types/service-stats';
import { getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';

// Instances share storage AND containers see the same filesystem under
// different mounts (/ vs /config, /mnt/disk vs /data vs a root-folder
// subpath), so path alone can't dedupe — one physical drive showed up as
// three "disks". Two entries are the same filesystem when totals match
// exactly and free space agrees within a tolerance (services sample free
// space moments apart, so it drifts slightly during writes).
const FREE_SPACE_TOLERANCE = 512 * 1024 ** 2; // 512 MiB

export function sameFilesystem(a: DiskSpace, b: DiskSpace): boolean {
  // Two distinct device labels (uuids) are different filesystems regardless of size —
  // never merge them, so two same-size drives don't collapse on a coincidental match.
  // When either label is missing fall back to the size + free-space heuristic.
  if (a.label && b.label && a.label !== b.label) return false;
  return a.totalSpace === b.totalSpace && Math.abs(a.freeSpace - b.freeSpace) <= FREE_SPACE_TOLERANCE;
}

// Keep the most identifiable entry: a real device label (uuid) first, then
// the shortest path (a host-style mount beats a container subpath).
export function preferDisk(a: DiskSpace, b: DiskSpace): DiskSpace {
  const aHasLabel = Boolean(a.label);
  const bHasLabel = Boolean(b.label);
  if (aHasLabel !== bHasLabel) return aHasLabel ? a : b;
  return a.path.length <= b.path.length ? a : b;
}

export function dedupeDiskSpace(disks: DiskSpace[]): DiskSpace[] {
  const out: DiskSpace[] = [];
  for (const disk of disks) {
    const matchIdx = out.findIndex((kept) => sameFilesystem(kept, disk));
    if (matchIdx === -1) out.push(disk);
    else out[matchIdx] = preferDisk(out[matchIdx], disk);
  }
  return out;
}

// Canonical identity for config + alert-state keys. This is the same identity
// preferDisk collapses to (device label first, path fallback), so a threshold
// the user sets matches exactly the deduped disk shown in the UI.
export function diskId(disk: Pick<DiskSpace, 'label' | 'path'>): string {
  return disk.label || disk.path;
}

type DiskClient = { getDiskSpace(): Promise<DiskSpace[]> };

async function diskSpaceForClients<C extends DiskClient>(
  getClients: () => Promise<Array<{ client: C }>>,
): Promise<DiskSpace[]> {
  let instances: Array<{ client: C }>;
  try {
    instances = await getClients();
  } catch {
    return [];
  }
  const per = await Promise.all(
    instances.map(async ({ client }) => {
      try {
        const disks = await client.getDiskSpace();
        return Array.isArray(disks) ? disks.filter((d): d is DiskSpace => Boolean(d)) : [];
      } catch {
        return [] as DiskSpace[];
      }
    }),
  );
  return per.flat();
}

// Union every connected Sonarr/Radarr/Lidarr instance's disks, then dedupe.
// Merge in a fixed Radarr→Sonarr→Lidarr order so dedupe tie-breaking stays
// deterministic — identical to /api/services/stats. Local services, no upstream
// rate limit, so this is cheap to run each poll cycle.
export async function getAggregatedDiskSpace(): Promise<DiskSpace[]> {
  const [radarr, sonarr, lidarr] = await Promise.all([
    diskSpaceForClients(getRadarrClients),
    diskSpaceForClients(getSonarrClients),
    diskSpaceForClients(getLidarrClients),
  ]);
  return dedupeDiskSpace([...radarr, ...sonarr, ...lidarr]);
}

// ─── Low-space alert config + runtime state ──────────────────────────────────

// User intent: a free-space threshold per disk. Persisted in AppSettings.diskThresholds.
export type DiskThreshold = {
  diskId: string;
  label: string;
  path: string;
  minFreeGb: number;
  enabled: boolean;
};

// Server-managed bookkeeping per disk, keyed by diskId. Persisted in
// AppSettings.diskAlertState. `below` is the last-seen below/above edge;
// `lastAlertAt` (ISO) gates the periodic re-reminder.
export type DiskAlertEntry = { below: boolean; lastAlertAt: string | null };
export type DiskAlertState = Record<string, DiskAlertEntry>;

// Tolerant read for runtime (GET + poller). Drops malformed entries silently;
// the PUT route does the strict, reject-with-400 validation instead.
export function parseDiskThresholds(raw: unknown): DiskThreshold[] {
  if (!Array.isArray(raw)) return [];
  const out: DiskThreshold[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.diskId !== 'string' || !e.diskId) continue;
    if (typeof e.minFreeGb !== 'number' || !Number.isFinite(e.minFreeGb) || e.minFreeGb < 0) continue;
    if (typeof e.enabled !== 'boolean') continue;
    out.push({
      diskId: e.diskId,
      label: typeof e.label === 'string' ? e.label : '',
      path: typeof e.path === 'string' ? e.path : '',
      minFreeGb: e.minFreeGb,
      enabled: e.enabled,
    });
  }
  return out;
}

export function parseDiskAlertState(raw: unknown): DiskAlertState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: DiskAlertState = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const e = value as Record<string, unknown>;
    out[key] = {
      below: e.below === true,
      lastAlertAt: typeof e.lastAlertAt === 'string' ? e.lastAlertAt : null,
    };
  }
  return out;
}

export function diskAlertStateEqual(a: DiskAlertState, b: DiskAlertState): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    const av = a[key];
    const bv = b[key];
    if (!bv || av.below !== bv.below || av.lastAlertAt !== bv.lastAlertAt) return false;
  }
  return true;
}
