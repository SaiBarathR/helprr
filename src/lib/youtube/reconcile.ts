import { reconcileJobs, checkToolsPaused, type ReconcileProfile } from '@/lib/archive/reconcile';
import { notifyAndLog } from '@/lib/polling/shared';
import { YOUTUBE } from '@/lib/youtube/platform';
import { getYoutubeSettings } from '@/lib/youtube/settings';

const PROFILE: ReconcileProfile = {
  platform: YOUTUBE,
  source: 'youtube',
  label: 'YouTube',
  queueUrl: '/youtube/queue',
  completeEvent: 'youtubeDownloadComplete',
  failedEvent: 'youtubeDownloadFailed',
  issueEvent: 'youtubeDownloadFailed',
  libraryItemId: async () => (await getYoutubeSettings()).jellyfinLibraryItemId,
  itemTag: (externalId) => `youtube-${externalId}`,
  videoUrl: (videoId) => `/youtube/video/${videoId}`,
  toolsPausedAt: async () => (await getYoutubeSettings()).toolsPausedAt,
};

// Once a day at most. Downloads that need the account stop without trying it again.
async function checkAccount(now: Date): Promise<void> {
  const { cookies, cookiesValid } = await getYoutubeSettings();
  if (!cookies || cookiesValid !== false) return;
  const url = '/settings/youtube/account';
  await notifyAndLog({
    eventType: 'youtubeCookiesExpired',
    title: 'Your spare YouTube account needs signing in',
    body: 'Age-restricted videos cannot download until you add a new cookies.txt.',
    url,
    dedupeKey: `youtube-cookies-expired-${now.toISOString().slice(0, 10)}`,
    metadata: { source: 'youtube', id: 'account', redirect: url },
  }, { service: 'youtube', instanceId: 'account', reason: 'cookies-expired' });
}

export async function reconcileYoutubeJobs(now: Date): Promise<void> {
  await reconcileJobs(now, PROFILE);
  await checkToolsPaused(PROFILE);
  await checkAccount(now);
}
