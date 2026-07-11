import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { seedInitialLayouts, getActiveLayoutForUser } from '@/lib/dashboard-layouts';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { NAV_ITEMS } from '@/lib/nav-config';
import { DashboardClient, type InitialDashboardLayout } from './dashboard-client';
import type { WidgetInstance } from '@/lib/widgets/types';

const DEVICE_COOKIE = 'helprr-device';

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(DEVICE_COOKIE)?.value;
  const device: 'desktop' | 'mobile' = cookieValue === 'mobile' ? 'mobile' : 'desktop';

  const user = await getCurrentUser();
  if (!user) redirect('/login');

  if (!can(user, 'dashboard.view')) {
    // App entry (/, PWA launch) hardcodes /dashboard as its fallback without
    // consulting capabilities, so a denied user must be redirected to their
    // first allowed section rather than 404'd straight after login. Only items
    // whose capability the user explicitly holds qualify — capability-less
    // items (e.g. library-gaps) can still 403 on their data routes — with
    // Settings (accessible to everyone) as the final fallback.
    const fallback = NAV_ITEMS.find(
      (item) => item.requiredCapability && can(user, item.requiredCapability)
    );
    redirect(fallback?.href ?? '/settings');
  }

  // Global built-ins are seeded for admins; members get their own personal set
  // (seeded on first load) resolved inside getActiveLayoutForUser.
  await seedInitialLayouts();
  const layout = await getActiveLayoutForUser({ id: user.id, role: user.role }, device);

  if (!layout) {
    // seedInitialLayouts guarantees at least two rows exist; if we somehow still
    // got null, something is badly wrong — bounce to login to surface auth issues.
    redirect('/login');
  }

  const initialLayout: InitialDashboardLayout = {
    id: layout.id,
    name: layout.name,
    widgets: Array.isArray(layout.widgets) ? (layout.widgets as WidgetInstance[]) : [],
    isBuiltIn: Boolean(layout.isBuiltIn),
  };

  return <DashboardClient initialLayout={initialLayout} initialDevice={device} />;
}
