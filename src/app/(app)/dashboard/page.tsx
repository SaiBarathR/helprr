import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getActiveLayoutCached } from '@/lib/cache/dashboard-layout-cache';
import { seedInitialLayouts } from '@/lib/dashboard-layouts';
import { DashboardClient, type InitialDashboardLayout } from './dashboard-client';
import type { WidgetInstance } from '@/lib/widgets/types';

const DEVICE_COOKIE = 'helprr-device';

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(DEVICE_COOKIE)?.value;
  const device: 'desktop' | 'mobile' = cookieValue === 'mobile' ? 'mobile' : 'desktop';

  await seedInitialLayouts();
  const layout = await getActiveLayoutCached(device);

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
