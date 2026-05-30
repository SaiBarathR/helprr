import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function UsersGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('users.manage');
  return <>{children}</>;
}
