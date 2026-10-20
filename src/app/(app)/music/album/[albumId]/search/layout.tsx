import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

// The release search and grab routes require activity.manage.
export default async function InteractiveSearchGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('activity.manage');
  return <>{children}</>;
}
