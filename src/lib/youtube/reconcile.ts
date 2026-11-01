import { reconcileJobs, checkToolsPaused, type ReconcileProfile } from '@/lib/archive/reconcile';
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

export async function reconcileYoutubeJobs(now: Date): Promise<void> {
  await reconcileJobs(now, PROFILE);
  await checkToolsPaused(PROFILE);
}
