import { CreatorPlatformProvider } from '@/components/creators/platform';
import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function TwitchGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('twitch.view');
  return <CreatorPlatformProvider platform="twitch">{children}</CreatorPlatformProvider>;
}
