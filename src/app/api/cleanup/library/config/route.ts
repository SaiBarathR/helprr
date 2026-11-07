import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import {
  loadLibraryCleanupSettings,
  normalizeLibraryCleanupSettings,
  saveLibraryCleanupSettings,
} from '@/lib/library-cleanup/config';
import { readJsonObject } from '../_shared';

async function getHandler() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json(await loadLibraryCleanupSettings());
}

async function putHandler(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  const parsed = normalizeLibraryCleanupSettings(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  await saveLibraryCleanupSettings(parsed.value);
  return NextResponse.json(parsed.value);
}

export const GET = withApiLogging(getHandler, 'api/cleanup/library/config');
export const PUT = withApiLogging(putHandler, 'api/cleanup/library/config');
