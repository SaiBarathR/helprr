import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function TwitchSettingsGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('twitch.manage');
  return <>{children}</>;
}
