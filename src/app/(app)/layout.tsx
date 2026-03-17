import { Sidebar } from '@/components/layout/sidebar';
import { AppShell } from '@/components/layout/app-shell';
import { StandaloneLaunchRedirect } from '@/components/layout/standalone-launch-redirect';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <StandaloneLaunchRedirect />
      <Sidebar />
      <AppShell>{children}</AppShell>
    </div>
  );
}
