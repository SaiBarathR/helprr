import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

export default async function CalendarGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('calendar.view');
  return <>{children}</>;
}
