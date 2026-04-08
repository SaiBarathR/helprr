import { Sidebar } from '@/components/layout/sidebar';
import { AppShell } from '@/components/layout/app-shell';
import { StandaloneLaunchRedirect } from '@/components/layout/standalone-launch-redirect';
import { HideImagesProvider } from '@/components/hide-images-provider';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <StandaloneLaunchRedirect />
      <HideImagesProvider />
      <Sidebar />
      <AppShell>{children}</AppShell>
    </div>
  );
}
