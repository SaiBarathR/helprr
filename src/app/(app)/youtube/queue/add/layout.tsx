import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function YoutubeQueueAddGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('youtube.download');
  return <>{children}</>;
}
