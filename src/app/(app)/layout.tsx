import { Sidebar } from '@/components/layout/sidebar';
import { BottomNav } from '@/components/layout/bottom-nav';
import { NavConfigProvider } from '@/components/layout/nav-config-provider';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <NavConfigProvider>
        <Sidebar />
        <div className="flex-1 flex flex-col min-h-screen min-w-0">
          <main className="flex-1 px-4 pb-24 md:pb-4 md:p-6 [overflow-x:clip]" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0.5rem))' }}>{children}</main>
          <BottomNav />
        </div>
      </NavConfigProvider>
    </div>
  );
}
