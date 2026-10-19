import { NextResponse } from 'next/server';
import { requireUserAllCapabilities } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';
import { preflightManualDownload } from '@/lib/manual-downloads/preflight';
import { ManualDownloadRequestError, readManualDownloadRequest, SERVICE_ADD_CAPABILITY, SERVICE_MONITOR_CAPABILITY } from '@/lib/manual-downloads/request';

/**
 * Check a manual download before anything is created or sent: the instance,
 * the title, the add options, the download client and how Arr reads the
 * release name. Changes nothing.
 */
async function postHandler(request: Request) {
  const auth = await requireUserAllCapabilities(['torrents.add', 'activity.manage']);
  if (!auth.ok) return auth.response;

  let parsed;
  try {
    parsed = await readManualDownloadRequest(await request.formData());
  } catch (error) {
    if (error instanceof ManualDownloadRequestError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (!can(auth.user, SERVICE_ADD_CAPABILITY[parsed.input.service])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (parsed.input.monitorTarget && !can(auth.user, SERVICE_MONITOR_CAPABILITY[parsed.input.service])) {
    return NextResponse.json({ error: 'Changing monitoring is not allowed for this account.' }, { status: 403 });
  }

  return NextResponse.json(await preflightManualDownload(parsed.input));
}

// The request can carry a magnet; keep request bodies out of the logs.
export const POST = withApiLogging(postHandler, 'api/manual-downloads/preflight', { logBodies: false });
