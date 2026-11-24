import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { PROWLARR_SYNC_LEVELS } from '@/lib/prowlarr-applications';
import type { ProwlarrApplicationBulkEdit, ProwlarrSyncLevel } from '@/lib/prowlarr-client';

const MAX_IDS = 50;
const MAX_TAGS = 100;
const ALLOWED_KEYS = new Set(['ids', 'syncLevel', 'tags', 'applyTags']);
const APPLY_TAGS = new Set(['add', 'remove', 'replace']);

const isPositiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

function parseBulkEdit(body: unknown): ProwlarrApplicationBulkEdit | string {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return 'Invalid JSON body';
  const record = body as Record<string, unknown>;
  const unknownKey = Object.keys(record).find((key) => !ALLOWED_KEYS.has(key));
  if (unknownKey) return `Unsupported field: ${unknownKey}`;

  const { ids, syncLevel, tags, applyTags } = record;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) return `ids must list 1 to ${MAX_IDS} apps`;
  if (!ids.every(isPositiveInteger)) return 'ids must be positive whole numbers';

  const edit: ProwlarrApplicationBulkEdit = { ids: [...new Set(ids as number[])] };
  if (syncLevel !== undefined) {
    if (typeof syncLevel !== 'string' || !(PROWLARR_SYNC_LEVELS as readonly string[]).includes(syncLevel)) {
      return 'syncLevel must be disabled, addOnly or fullSync';
    }
    edit.syncLevel = syncLevel as ProwlarrSyncLevel;
  }
  if ((tags === undefined) !== (applyTags === undefined)) return 'tags and applyTags go together';
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.length > MAX_TAGS || !tags.every(isPositiveInteger)) {
      return 'tags must be a list of positive whole numbers';
    }
    if (typeof applyTags !== 'string' || !APPLY_TAGS.has(applyTags)) return 'applyTags must be add, remove or replace';
    edit.tags = [...new Set(tags as number[])];
    edit.applyTags = applyTags as ProwlarrApplicationBulkEdit['applyTags'];
  }
  if (Object.keys(edit).length === 1) return 'Nothing to change';
  return edit;
}

/**
 * Change apps' sync level or tags through Prowlarr's bulk editor, which changes
 * only the properties sent, so the apps' settings (their arr's API key) never
 * pass through Helprr. It saves tags without checking them, so they are checked
 * here. Responds with `{ ok: true }`: Prowlarr's own response holds whole apps.
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
    if (edit.tags?.length) {
      const known = new Set((await client.getTags()).map((tag) => tag.id));
      if (!edit.tags.every((tag) => known.has(tag))) {
        return NextResponse.json({ error: 'That tag no longer exists' }, { status: 400 });
      }
    }
    await client.bulkEditApplications(edit);
    return NextResponse.json({ ok: true });
  } catch (error) {
    // Prowlarr answers 404 for an app deleted while the page was open.
    return upstreamErrorResponse(error, 'Failed to update app');
  }
}

export const PUT = withApiLogging(putHandler, 'api/prowlarr/applications/bulk');
