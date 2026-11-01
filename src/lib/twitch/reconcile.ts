import { checkToolsPaused, checkWorker, reconcileJobs, type ReconcileProfile } from '@/lib/archive/reconcile';
import { TWITCH } from '@/lib/twitch/platform';
import { getTwitchSettings } from '@/lib/twitch/settings';

const PROFILE: ReconcileProfile = {
  platform: TWITCH,
  source: 'twitch',
  label: 'Twitch',
  queueUrl: '/twitch/queue',
  completeEvent: 'twitchDownloadComplete',
  failedEvent: 'twitchDownloadFailed',
  issueEvent: 'twitchWorkerIssue',
  libraryItemId: async () => (await getTwitchSettings()).jellyfinLibraryItemId,
  itemTag: (externalId) => `twitch-v${externalId}`,
  videoUrl: (videoId) => `/twitch/vod/${videoId}`,
  toolsPausedAt: async () => (await getTwitchSettings()).toolsPausedAt,
};

export async function reconcileTwitchJobs(now: Date): Promise<void> {
  await reconcileJobs(now, PROFILE);
  await checkWorker(now);
  await checkToolsPaused(PROFILE);
}
