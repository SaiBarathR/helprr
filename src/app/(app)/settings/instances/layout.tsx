import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function InstancesGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('settings.instances');
  return <>{children}</>;
}
