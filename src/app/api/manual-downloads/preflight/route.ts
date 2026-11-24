import { NextResponse } from 'next/server';
import { requireUserAllCapabilities } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';
import { preflightManualDownload } from '@/lib/manual-downloads/preflight';
import { ManualDownloadForbiddenError, ManualDownloadRequestError, readManualDownloadRequest, SERVICE_ADD_CAPABILITY, SERVICE_MONITOR_CAPABILITY } from '@/lib/manual-downloads/request';
import { prowlarrReleaseSource } from '@/lib/manual-downloads/prowlarr-release';

/**
 * Check a manual download before anything is created or sent: the instance,
 * the title, the add options, the download client and how Arr reads the
 * release name. Changes nothing in Arr. A Prowlarr search result is fetched
 * through Prowlarr here (once, then kept a few minutes), which Prowlarr logs
 * as a grab and a private tracker may count.
 */
async function postHandler(request: Request) {
  const auth = await requireUserAllCapabilities(['torrents.add', 'activity.manage']);
  if (!auth.ok) return auth.response;

  let parsed;
  try {
    parsed = await readManualDownloadRequest(await request.formData(), {
      // Checked before the release is read: a Prowlarr result is fetched from Prowlarr.
      authorize: ({ service, monitorTarget, prowlarr }) => {
        if (!can(auth.user, SERVICE_ADD_CAPABILITY[service])) throw new ManualDownloadForbiddenError();
        if (monitorTarget && !can(auth.user, SERVICE_MONITOR_CAPABILITY[service])) {
          throw new ManualDownloadForbiddenError('Changing monitoring is not allowed for this account.');
        }
        // A Prowlarr search result also needs what searching needs.
        if (prowlarr && !can(auth.user, 'prowlarr.manage')) throw new ManualDownloadForbiddenError();
      },
      prowlarrSource: (token) => prowlarrReleaseSource(auth.user.id, token),
    });
  } catch (error) {
    if (error instanceof ManualDownloadForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof ManualDownloadRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  return NextResponse.json(await preflightManualDownload(parsed.input));
}

// The request can carry a magnet; keep request bodies out of the logs.
export const POST = withApiLogging(postHandler, 'api/manual-downloads/preflight', { logBodies: false });
