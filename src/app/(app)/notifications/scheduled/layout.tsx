import { assertPageCapability } from '@/lib/page-guard';

export const dynamic = 'force-dynamic';

// Guarded separately from the (history) sibling: scheduled alerts are reached
// from the calendar page and push URLs, and their API enforces
// scheduledAlerts.view — not notifications.view.
export default async function ScheduledAlertsGuardLayout({ children }: { children: React.ReactNode }) {
  await assertPageCapability('scheduledAlerts.view');
  return <>{children}</>;
}
