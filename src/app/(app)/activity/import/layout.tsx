import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function ActivityImportGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('activity.manage');
  return <>{children}</>;
}
