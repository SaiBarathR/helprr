// Shared request parsing for the bulk editor routes (/api/{sonarr,radarr,lidarr}/editor).
// The three services differ in their id field name, caps, and which settings fields
// their native /editor endpoint takes, so the wire payload is parsed once here per service.

export type ApplyTags = 'add' | 'remove' | 'replace';

export type BulkEditService = 'sonarr' | 'radarr' | 'lidarr';

export const SERIES_TYPES = ['standard', 'daily', 'anime'] as const;
export const MINIMUM_AVAILABILITIES = ['announced', 'inCinemas', 'released'] as const;
export const MONITOR_NEW_ITEMS = ['all', 'none'] as const;

export interface BulkEditFields {
  ids: number[];
  monitored?: boolean;
  // Tags are carried as labels (not ids): tag ids differ between arr instances, so
  // the route resolves each label to that instance's tag id (creating it on `add`).
  tags?: string[];
  applyTags?: ApplyTags;
  // Settings fields. Profile ids and the root folder are per-instance values the route
  // checks against that instance before the write.
  qualityProfileId?: number;
  rootFolderPath?: string;
  /** Only with rootFolderPath: the *arr moves each item's files into the new root folder. */
  moveFiles?: boolean;
  seriesType?: (typeof SERIES_TYPES)[number];
  seasonFolder?: boolean;
  monitorNewItems?: (typeof MONITOR_NEW_ITEMS)[number];
  minimumAvailability?: (typeof MINIMUM_AVAILABILITIES)[number];
  metadataProfileId?: number;
}

// The settings fields each service's /editor endpoint accepts. A field another service
// owns is rejected rather than silently dropped, so a mistyped request fails loudly.
const SETTINGS_FIELDS: Record<BulkEditService, readonly string[]> = {
  sonarr: ['qualityProfileId', 'rootFolderPath', 'moveFiles', 'seriesType', 'seasonFolder', 'monitorNewItems'],
  radarr: ['qualityProfileId', 'rootFolderPath', 'moveFiles', 'minimumAvailability'],
  lidarr: ['qualityProfileId', 'rootFolderPath', 'moveFiles', 'metadataProfileId', 'monitorNewItems'],
};

const ALL_SETTINGS_FIELDS = [
  'qualityProfileId', 'rootFolderPath', 'moveFiles', 'seriesType', 'seasonFolder',
  'monitorNewItems', 'minimumAvailability', 'metadataProfileId',
] as const;

/** True when the edit changes a setting no capability covers (admin-only). */
export function changesAdminOnlyFields(fields: BulkEditFields): boolean {
  return (
    fields.qualityProfileId !== undefined ||
    fields.seriesType !== undefined ||
    fields.seasonFolder !== undefined ||
    fields.monitorNewItems !== undefined ||
    fields.minimumAvailability !== undefined ||
    fields.metadataProfileId !== undefined
  );
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

// Duplicates are dropped so a repeated id isn't edited (or counted in the audit) twice.
function toPositiveIntArray(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const seen = new Set<number>();
  for (const entry of value) {
    const n = Number(entry);
    if (!Number.isInteger(n) || n <= 0) return null;
    seen.add(n);
  }
  return [...seen];
}

// Bounds one bulk edit request (and its audit row) while staying above a "select all"
// on a large library, which the pages send as one request per instance.
export const MAX_BULK_EDIT_IDS = 50_000;

export function parseBulkEditBody(
  body: unknown,
  service: BulkEditService
): BulkEditFields | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid body' };
  const b = body as Record<string, unknown>;

  const ids = toPositiveIntArray(b.ids);
  if (!ids) return { error: 'ids must be a non-empty array of positive integers' };
  if (ids.length > MAX_BULK_EDIT_IDS) return { error: `ids must list at most ${MAX_BULK_EDIT_IDS} items` };

  const fields: BulkEditFields = { ids };

  if (b.monitored !== undefined) {
    if (typeof b.monitored !== 'boolean') return { error: 'monitored must be a boolean' };
    fields.monitored = b.monitored;
  }

  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || b.tags.length === 0) {
      return { error: 'tags must be a non-empty array of labels' };
    }
    const labels: string[] = [];
    for (const t of b.tags) {
      if (typeof t !== 'string' || !t.trim()) return { error: 'tags must be non-empty strings' };
      labels.push(t.trim());
    }
    if (b.applyTags !== 'add' && b.applyTags !== 'remove' && b.applyTags !== 'replace') {
      return { error: "applyTags must be 'add', 'remove', or 'replace'" };
    }
    fields.tags = labels;
    fields.applyTags = b.applyTags;
  }

  for (const key of ALL_SETTINGS_FIELDS) {
    if (b[key] !== undefined && !SETTINGS_FIELDS[service].includes(key)) {
      return { error: `${key} is not a ${service} bulk edit field` };
    }
  }

  if (b.qualityProfileId !== undefined) {
    if (!isPositiveInt(b.qualityProfileId)) return { error: 'qualityProfileId must be a positive integer' };
    fields.qualityProfileId = b.qualityProfileId;
  }
  if (b.metadataProfileId !== undefined) {
    if (!isPositiveInt(b.metadataProfileId)) return { error: 'metadataProfileId must be a positive integer' };
    fields.metadataProfileId = b.metadataProfileId;
  }
  if (b.rootFolderPath !== undefined) {
    if (typeof b.rootFolderPath !== 'string' || !b.rootFolderPath.trim()) {
      return { error: 'rootFolderPath must be a non-empty string' };
    }
    fields.rootFolderPath = b.rootFolderPath;
  }
  if (b.moveFiles !== undefined) {
    if (typeof b.moveFiles !== 'boolean') return { error: 'moveFiles must be a boolean' };
    if (fields.rootFolderPath === undefined) return { error: 'moveFiles requires rootFolderPath' };
    fields.moveFiles = b.moveFiles;
  }
  if (b.seriesType !== undefined) {
    if (!isOneOf(SERIES_TYPES, b.seriesType)) return { error: `seriesType must be one of ${SERIES_TYPES.join(', ')}` };
    fields.seriesType = b.seriesType;
  }
  if (b.seasonFolder !== undefined) {
    if (typeof b.seasonFolder !== 'boolean') return { error: 'seasonFolder must be a boolean' };
    fields.seasonFolder = b.seasonFolder;
  }
  if (b.monitorNewItems !== undefined) {
    if (!isOneOf(MONITOR_NEW_ITEMS, b.monitorNewItems)) {
      return { error: `monitorNewItems must be one of ${MONITOR_NEW_ITEMS.join(', ')}` };
    }
    fields.monitorNewItems = b.monitorNewItems;
  }
  if (b.minimumAvailability !== undefined) {
    if (!isOneOf(MINIMUM_AVAILABILITIES, b.minimumAvailability)) {
      return { error: `minimumAvailability must be one of ${MINIMUM_AVAILABILITIES.join(', ')}` };
    }
    fields.minimumAvailability = b.minimumAvailability;
  }

  if (
    fields.monitored === undefined &&
    fields.tags === undefined &&
    fields.rootFolderPath === undefined &&
    !changesAdminOnlyFields(fields)
  ) {
    return { error: 'Nothing to update' };
  }
  return fields;
}

/**
 * Check the per-instance values in a bulk edit against that instance: a profile id or
 * root folder from another instance (ids and paths differ between instances) is
 * rejected before anything is written. Returns an error message, or null when valid.
 */
export async function validateInstanceSettings(
  client: {
    getQualityProfiles(): Promise<{ id: number }[]>;
    getRootFolders(): Promise<{ path: string }[]>;
    getMetadataProfiles?(): Promise<{ id: number }[]>;
  },
  fields: BulkEditFields
): Promise<string | null> {
  const [qualityProfiles, rootFolders, metadataProfiles] = await Promise.all([
    fields.qualityProfileId !== undefined ? client.getQualityProfiles() : null,
    fields.rootFolderPath !== undefined ? client.getRootFolders() : null,
    fields.metadataProfileId !== undefined && client.getMetadataProfiles ? client.getMetadataProfiles() : null,
  ]);
  if (qualityProfiles && !qualityProfiles.some((p) => p.id === fields.qualityProfileId)) {
    return `Quality profile ${fields.qualityProfileId} does not exist on this instance`;
  }
  if (rootFolders && !rootFolders.some((f) => f.path === fields.rootFolderPath)) {
    return 'Root folder does not exist on this instance';
  }
  if (fields.metadataProfileId !== undefined && !metadataProfiles?.some((p) => p.id === fields.metadataProfileId)) {
    return `Metadata profile ${fields.metadataProfileId} does not exist on this instance`;
  }
  return null;
}

interface TaggableClient {
  getTags(): Promise<{ id: number; label: string }[]>;
  createTag(label: string): Promise<{ id: number; label: string }>;
}

/**
 * Resolve tag labels to this instance's numeric tag ids. On 'add'/'replace' a label
 * with no match is created; on 'remove' an unknown label is simply skipped (no point
 * creating a tag only to remove it). Matching is case-insensitive. `createdAny` lets the
 * caller invalidate the reference-label cache only when a brand-new tag was actually made.
 */
export async function resolveTagIds(
  client: TaggableClient,
  labels: string[],
  mode: ApplyTags
): Promise<{ ids: number[]; createdAny: boolean }> {
  const existing = await client.getTags();
  const byLabel = new Map(existing.map((t) => [t.label.toLowerCase(), t.id]));
  const ids: number[] = [];
  let createdAny = false;
  for (const label of labels) {
    const found = byLabel.get(label.toLowerCase());
    if (found !== undefined) {
      ids.push(found);
    } else if (mode !== 'remove') {
      const created = await client.createTag(label);
      createdAny = true;
      ids.push(created.id);
      // Record it so a later case-variant of the same new label in this batch
      // (e.g. "foo" then "Foo") reuses the id instead of creating a duplicate tag.
      byLabel.set(label.toLowerCase(), created.id);
    }
  }
  return { ids, createdAny };
}

export function parseBulkDeleteBody(
  body: unknown
): { ids: number[]; deleteFiles: boolean } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid body' };
  const b = body as Record<string, unknown>;
  const ids = toPositiveIntArray(b.ids);
  if (!ids) return { error: 'ids must be a non-empty array of positive integers' };
  if (b.deleteFiles !== undefined && typeof b.deleteFiles !== 'boolean') {
    return { error: 'deleteFiles must be a boolean' };
  }
  return { ids, deleteFiles: b.deleteFiles === true };
}

/**
 * Read a request's JSON body without letting a malformed payload throw past the
 * handler (where it would surface as a 500). On bad JSON the caller returns 400 —
 * a malformed body is a client error, not a server error.
 */
export async function readJsonBody(
  request: Request
): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}
