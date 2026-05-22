import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { AppShell } from '@/components/layout/app-shell';
import { StandaloneLaunchRedirect } from '@/components/layout/standalone-launch-redirect';
import { DiscoverLayoutHydrator } from '@/components/discover-layout-hydrator';
import { getSession } from '@/lib/auth';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Edge middleware only checks the JWT signature/sid claim; it can't reach
  // the DB to confirm the Session row hasn't been revoked. Gate every
  // protected page here (node runtime) so revocation takes effect for SSR
  // navs, not just on the next API call.
  if (!(await getSession())) {
    redirect('/login');
  }

  return (
    <div className="flex min-h-screen bg-background">
      <StandaloneLaunchRedirect />
      <DiscoverLayoutHydrator />
      <Sidebar />
      <AppShell>{children}</AppShell>
    </div>
  );
}
