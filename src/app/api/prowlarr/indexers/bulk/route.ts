import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

const MAX_IDS = 200;
const ALLOWED_KEYS = new Set(['ids', 'enable']);

type BulkEdit = { ids: number[]; enable: boolean };

function parseBulkEdit(body: unknown): BulkEdit | string {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return 'Invalid JSON body';
  const record = body as Record<string, unknown>;
  const unknownKey = Object.keys(record).find((key) => !ALLOWED_KEYS.has(key));
  if (unknownKey) return `Unsupported field: ${unknownKey}`;

  const { ids, enable } = record;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) {
    return `ids must list 1 to ${MAX_IDS} indexers`;
  }
  if (!ids.every((id) => Number.isSafeInteger(id) && (id as number) > 0)) {
    return 'ids must be positive whole numbers';
  }
  if (typeof enable !== 'boolean') return 'enable must be true or false';
  return { ids: [...new Set(ids as number[])], enable };
}

/**
 * Enable or disable indexers through Prowlarr's bulk editor, which changes only
 * the properties sent. Responds with `{ ok: true }`: Prowlarr's own response
 * holds whole indexers, settings included.
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
    await client.bulkEditIndexers(edit);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return upstreamErrorResponse(error, edit.enable ? 'Failed to enable indexer' : 'Failed to disable indexer');
  }
}

export const PUT = withApiLogging(putHandler, 'api/prowlarr/indexers/bulk');
