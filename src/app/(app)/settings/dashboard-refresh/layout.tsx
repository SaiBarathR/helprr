import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function DashboardRefreshGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('settings.dashboardRefresh');
  return <>{children}</>;
}
