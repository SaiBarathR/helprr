import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function TorrentsGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('torrents.view');
  return <>{children}</>;
}
