// Shared request parsing for the bulk editor routes (/api/{sonarr,radarr,lidarr}/editor).
// The three services differ only in their id field name and caps; the wire payload
// (`{ ids, monitored?, tags?, applyTags? }`) is identical, so it's parsed once here.

export type ApplyTags = 'add' | 'remove' | 'replace';

export interface BulkEditFields {
  ids: number[];
  monitored?: boolean;
  // Tags are carried as labels (not ids): tag ids differ between arr instances, so
  // the route resolves each label to that instance's tag id (creating it on `add`).
  tags?: string[];
  applyTags?: ApplyTags;
}

function toPositiveIntArray(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: number[] = [];
  for (const entry of value) {
    const n = Number(entry);
    if (!Number.isInteger(n) || n <= 0) return null;
    out.push(n);
  }
  return out;
}

export function parseBulkEditBody(body: unknown): BulkEditFields | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid body' };
  const b = body as Record<string, unknown>;

  const ids = toPositiveIntArray(b.ids);
  if (!ids) return { error: 'ids must be a non-empty array of positive integers' };

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

  if (fields.monitored === undefined && fields.tags === undefined) {
    return { error: 'Nothing to update: provide monitored or tags' };
  }
  return fields;
}

interface TaggableClient {
  getTags(): Promise<{ id: number; label: string }[]>;
  createTag(label: string): Promise<{ id: number; label: string }>;
}

/**
 * Resolve tag labels to this instance's numeric tag ids. On 'add'/'replace' a label
 * with no match is created; on 'remove' an unknown label is simply skipped (no point
 * creating a tag only to remove it). Matching is case-insensitive.
 */
export async function resolveTagIds(
  client: TaggableClient,
  labels: string[],
  mode: ApplyTags
): Promise<number[]> {
  const existing = await client.getTags();
  const byLabel = new Map(existing.map((t) => [t.label.toLowerCase(), t.id]));
  const ids: number[] = [];
  for (const label of labels) {
    const found = byLabel.get(label.toLowerCase());
    if (found !== undefined) {
      ids.push(found);
    } else if (mode !== 'remove') {
      const created = await client.createTag(label);
      ids.push(created.id);
      // Record it so a later case-variant of the same new label in this batch
      // (e.g. "foo" then "Foo") reuses the id instead of creating a duplicate tag.
      byLabel.set(label.toLowerCase(), created.id);
    }
  }
  return ids;
}

export function parseBulkDeleteBody(
  body: unknown
): { ids: number[]; deleteFiles: boolean } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid body' };
  const b = body as Record<string, unknown>;
  const ids = toPositiveIntArray(b.ids);
  if (!ids) return { error: 'ids must be a non-empty array of positive integers' };
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
