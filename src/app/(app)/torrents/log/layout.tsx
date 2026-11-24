import { assertPageAdmin } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function TorrentLogGuardLayout({ children }: { children: React.ReactNode }) {
  // Admin role, not a capability: /api/qbittorrent/log hard-requires admin.
  await assertPageAdmin();
  return <>{children}</>;
}
