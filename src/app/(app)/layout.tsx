import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { AppShell } from '@/components/layout/app-shell';
import { CommandPalette } from '@/components/search/command-palette';
import { StandaloneLaunchRedirect } from '@/components/layout/standalone-launch-redirect';
import { DiscoverLayoutHydrator } from '@/components/discover-layout-hydrator';
import { PermissionProvider, type MePayload } from '@/components/permission-provider';
import { QueryProvider } from '@/components/query-provider';
import { BadgeProvider } from '@/components/layout/badge-provider';
import { RequestedMediaProvider } from '@/components/seerr/requested-media-provider';
import { WatchStatusProvider } from '@/components/jellyfin/watch-status-provider';
import { ImageCacheGenerationInit } from '@/components/image-cache-generation-init';
import { getCurrentUser } from '@/lib/auth';
import { effectiveCapabilities } from '@/lib/permissions';
import { setImageCacheGeneration } from '@/lib/image';
import { getCacheGeneration } from '@/lib/cache/state';
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
  // Independent of each other, so resolve in parallel to keep one DB round-trip
  // off the critical path of every authenticated navigation.
  const [user, seerrCount, tmdbCount, jellyfinCount, imageCacheGeneration] = await Promise.all([
    getCurrentUser(),
    prisma.serviceConnection.count({ where: { type: 'SEERR' } }),
    prisma.serviceConnection.count({ where: { type: 'TMDB' } }),
    prisma.serviceConnection.count({ where: { type: 'JELLYFIN' } }),
    getCacheGeneration(),
  ]);
  if (!user) {
    redirect('/login');
  }

  // Seed the server bundle's token so SSR-rendered image URLs (in this and
  // descendant server/client components) carry ?v=<generation>.
  setImageCacheGeneration(imageCacheGeneration);

  const seerrConfigured = seerrCount > 0;
  const tmdbConfigured = tmdbCount > 0;
  // Admins fall back to the connection's configured user, so "configured" ⇒
  // "linked" for them; members need their own jellyfinUserId.
  const jellyfinLinked = jellyfinCount > 0 && (user.role === 'admin' || Boolean(user.jellyfinUserId));

  const me: MePayload = {
    id: user.id,
    name: user.displayName,
    username: user.username,
    role: user.role,
    template: user.template,
    capabilities: effectiveCapabilities(user),
    seerrConfigured,
    tmdbConfigured,
    seerrUserId: user.seerrUserId,
    jellyfinLinked,
    customHeadersEnabled: process.env.HELPRR_CUSTOM_HEADERS === 'true',
  };

  return (
    <QueryProvider>
      <PermissionProvider value={me}>
        <ImageCacheGenerationInit value={imageCacheGeneration} />
        <RequestedMediaProvider>
          <WatchStatusProvider>
            <BadgeProvider>
            <div className="flex min-h-screen bg-background">
              <StandaloneLaunchRedirect />
              <DiscoverLayoutHydrator />
              <CommandPalette />
              <Sidebar />
              <AppShell>{children}</AppShell>
            </div>
            </BadgeProvider>
          </WatchStatusProvider>
        </RequestedMediaProvider>
      </PermissionProvider>
    </QueryProvider>
  );
}
