import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function LogsGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('logs.view');
  return <>{children}</>;
}
