import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function TwitchQueueAddGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('twitch.download');
  return <>{children}</>;
}
