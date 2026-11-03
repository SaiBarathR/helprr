import { CreatorPlatformProvider } from '@/components/creators/platform';
import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function YoutubeGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('youtube.view');
  return <CreatorPlatformProvider platform="youtube">{children}</CreatorPlatformProvider>;
}
