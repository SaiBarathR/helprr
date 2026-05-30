import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function ProwlarrGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('prowlarr.view');
  return <>{children}</>;
}
