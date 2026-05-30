import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function BackupGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('settings.backup');
  return <>{children}</>;
}
