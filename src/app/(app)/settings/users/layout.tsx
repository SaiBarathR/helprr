import { assertPageAdmin } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function UsersGuardLayout({ children }: { children: React.ReactNode }) {
  // Admin role, not a capability: the /api/users routes hard-require admin.
  await assertPageAdmin();
  return <>{children}</>;
}
