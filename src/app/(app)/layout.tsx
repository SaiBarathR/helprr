import { Sidebar } from '@/components/layout/sidebar';
import { BottomNav } from '@/components/layout/bottom-nav';
import { Header } from '@/components/layout/header';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        {/* Header: hidden on mobile detail pages via CSS, visible on desktop */}
        <div className="hidden md:block">
          <Header />
        </div>
        <main className="flex-1 px-4 pb-24 md:pb-4 md:p-6 [overflow-x:clip]" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0.5rem))' }}>{children}</main>
        <BottomNav />
      </div>
    </div>
  );
}
