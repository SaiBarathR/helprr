import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireCapability } from '@/lib/auth';
import { deleteLogFile, listLogFiles } from '@/lib/logger';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler() {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('logs.view');
  if (capError) return capError;

  return NextResponse.json({ files: await listLogFiles() });
}

async function deleteHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('logs.manage');
  if (capError) return capError;

  const all = request.nextUrl.searchParams.get('all') === 'true';
  if (all) {
    const files = await listLogFiles();
    let deleted = 0;
    for (const entry of files) {
      try {
        await deleteLogFile(entry.name);
        deleted += 1;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          return NextResponse.json(
            { error: 'Failed to delete log files', deleted },
            { status: 500 }
          );
        }
      }
    }
    return NextResponse.json({ success: true, deleted });
  }

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
