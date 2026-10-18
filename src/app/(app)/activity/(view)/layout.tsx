import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function ActivityGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('activity.view');
  return <>{children}</>;
}
