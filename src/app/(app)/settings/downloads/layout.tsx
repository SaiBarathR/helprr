import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function DownloadsGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('settings.downloads');
  return <>{children}</>;
}
