import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

// The torrents layout already requires torrents.view; manual downloads also need activity.view.
export default async function LinkedDownloadsGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('activity.view');
  return <>{children}</>;
}
