import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { AppShell } from '@/components/layout/app-shell';
import { StandaloneLaunchRedirect } from '@/components/layout/standalone-launch-redirect';
import { DiscoverLayoutHydrator } from '@/components/discover-layout-hydrator';
import { PermissionProvider, type MePayload } from '@/components/permission-provider';
import { RequestedMediaProvider } from '@/components/seerr/requested-media-provider';
import { getCurrentUser } from '@/lib/auth';
import { effectiveCapabilities } from '@/lib/permissions';
import { prisma } from '@/lib/db';

// Revocation is enforced server-side here (getSession() hits the DB on every
// invocation). Force-dynamic guarantees this layout re-runs on every request
// instead of being served from Next.js's full-route cache, so a session
// revoked from another device takes effect on the very next navigation.
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Edge middleware only checks the JWT signature/sid claim; it can't reach
  // the DB to confirm the Session row hasn't been revoked (or the user
  // disabled). Resolve the user here (node runtime) so revocation/disable take
  // effect for SSR navs, and so the permission provider is seeded server-side.
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const seerrConfigured = (await prisma.serviceConnection.count({ where: { type: 'SEERR' } })) > 0;

  const me: MePayload = {
    id: user.id,
    name: user.displayName,
    username: user.username,
    role: user.role,
    template: user.template,
    capabilities: effectiveCapabilities(user),
    seerrConfigured,
    seerrUserId: user.seerrUserId,
  };

  return (
    <PermissionProvider value={me}>
      <RequestedMediaProvider>
        <div className="flex min-h-screen bg-background">
          <StandaloneLaunchRedirect />
          <DiscoverLayoutHydrator />
          <Sidebar />
          <AppShell>{children}</AppShell>
        </div>
      </RequestedMediaProvider>
    </PermissionProvider>
  );
}
