import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import type { ProwlarrBulkEdit } from '@/lib/prowlarr-client';

const MAX_IDS = 200;
const MAX_TAGS = 100;
const MIN_PRIORITY = 1;
const MAX_PRIORITY = 50;
const ALLOWED_KEYS = new Set(['ids', 'enable', 'priority', 'appProfileId', 'tags', 'applyTags']);
const APPLY_TAGS = new Set(['add', 'remove', 'replace']);

const isPositiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

function parseBulkEdit(body: unknown): ProwlarrBulkEdit | string {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return 'Invalid JSON body';
  const record = body as Record<string, unknown>;
  const unknownKey = Object.keys(record).find((key) => !ALLOWED_KEYS.has(key));
  if (unknownKey) return `Unsupported field: ${unknownKey}`;

  const { ids, enable, priority, appProfileId, tags, applyTags } = record;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) {
    return `ids must list 1 to ${MAX_IDS} indexers`;
  }
  if (!ids.every(isPositiveInteger)) return 'ids must be positive whole numbers';

  const edit: ProwlarrBulkEdit = { ids: [...new Set(ids as number[])] };
  if (enable !== undefined) {
    if (typeof enable !== 'boolean') return 'enable must be true or false';
    edit.enable = enable;
  }
  if (priority !== undefined) {
    if (!Number.isSafeInteger(priority) || (priority as number) < MIN_PRIORITY || (priority as number) > MAX_PRIORITY) {
      return `priority must be a whole number from ${MIN_PRIORITY} to ${MAX_PRIORITY}`;
    }
    edit.priority = priority as number;
  }
  if (appProfileId !== undefined) {
    if (!isPositiveInteger(appProfileId)) return 'appProfileId must be a positive whole number';
    edit.appProfileId = appProfileId;
  }
  if ((tags === undefined) !== (applyTags === undefined)) return 'tags and applyTags go together';
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.length > MAX_TAGS || !tags.every(isPositiveInteger)) {
      return 'tags must be a list of positive whole numbers';
    }
    if (typeof applyTags !== 'string' || !APPLY_TAGS.has(applyTags)) return 'applyTags must be add, remove or replace';
    edit.tags = [...new Set(tags as number[])];
    edit.applyTags = applyTags as ProwlarrBulkEdit['applyTags'];
  }
  if (Object.keys(edit).length === 1) return 'Nothing to change';
  return edit;
}

/**
 * Change indexers through Prowlarr's bulk editor, which changes only the
 * properties sent. It saves what it is given without checking it, so the range,
 * the app profile and the tags are checked here. Responds with `{ ok: true }`:
 * Prowlarr's own response holds whole indexers, settings included.
 */
async function putHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('prowlarr.manage');
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const edit = parseBulkEdit(body);
  if (typeof edit === 'string') return NextResponse.json({ error: edit }, { status: 400 });

  try {
    const client = await getProwlarrClient();
    if (edit.appProfileId !== undefined) {
      const profiles = await client.getAppProfiles();
      if (!profiles.some((profile) => profile.id === edit.appProfileId)) {
        return NextResponse.json({ error: 'That app profile no longer exists' }, { status: 400 });
      }
    }
    if (edit.tags?.length) {
      const known = new Set((await client.getTags()).map((tag) => tag.id));
      if (!edit.tags.every((tag) => known.has(tag))) {
        return NextResponse.json({ error: 'That tag no longer exists' }, { status: 400 });
      }
    }
    await client.bulkEditIndexers(edit);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const onlyEnable = Object.keys(edit).length === 2 && edit.enable !== undefined;
    return upstreamErrorResponse(
      error,
      onlyEnable ? (edit.enable ? 'Failed to enable indexer' : 'Failed to disable indexer') : 'Failed to update indexer',
    );
  }
}

export const PUT = withApiLogging(putHandler, 'api/prowlarr/indexers/bulk');
