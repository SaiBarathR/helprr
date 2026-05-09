import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { deleteLogFile, listLogFiles } from '@/lib/logger';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler() {
  const authError = await requireAuth();
  if (authError) return authError;

  return NextResponse.json({ files: await listLogFiles() });
}

async function deleteHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const file = request.nextUrl.searchParams.get('file');
  if (!file) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  try {
    await deleteLogFile(file);
    return NextResponse.json({ success: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return NextResponse.json({ error: 'Log file not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to delete log file' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/logs/files');
export const DELETE = withApiLogging(deleteHandler, 'api/logs/files');
