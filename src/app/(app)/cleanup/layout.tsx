import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function CleanupGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('cleanup.view');
  return <>{children}</>;
}
