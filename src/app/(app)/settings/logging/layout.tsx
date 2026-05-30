import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function LoggingGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('settings.logging');
  return <>{children}</>;
}
