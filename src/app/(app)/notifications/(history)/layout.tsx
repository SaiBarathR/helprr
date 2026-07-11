import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function NotificationsGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('notifications.view');
  return <>{children}</>;
}
