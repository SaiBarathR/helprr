import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function StorageGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('settings.storage');
  return <>{children}</>;
}
