import { assertPageAdmin } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function FileAuditGuardLayout({ children }: { children: React.ReactNode }) {
  // Admin role, not a capability: /api/file-audit hard-requires admin.
  await assertPageAdmin();
  return <>{children}</>;
}
