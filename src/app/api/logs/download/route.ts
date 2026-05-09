import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSafeLogFilePath } from '@/lib/logger';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const file = request.nextUrl.searchParams.get('file');
  if (!file) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  let fullPath: string;
  try {
    fullPath = getSafeLogFilePath(file);
  } catch {
    return NextResponse.json({ error: 'Invalid log file' }, { status: 400 });
  }

  const bytes = await fs.promises.readFile(fullPath).catch(() => null);
  if (!bytes) {
    return NextResponse.json({ error: 'Log file not found' }, { status: 404 });
  }

  return new NextResponse(bytes, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'content-disposition': `attachment; filename="${path.basename(file)}"`,
    },
  });
}

export const GET = withApiLogging(getHandler, 'api/logs/download');
