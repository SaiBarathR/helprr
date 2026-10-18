import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function InsightsGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('insights.view');
  return <>{children}</>;
}
