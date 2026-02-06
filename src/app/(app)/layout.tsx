import { Sidebar } from '@/components/layout/sidebar';
import { BottomNav } from '@/components/layout/bottom-nav';
import { Header } from '@/components/layout/header';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        <Header />
        <main className="flex-1 p-4 pb-20 md:pb-4 md:p-6 overflow-x-hidden">{children}</main>
        <BottomNav />
      </div>
    </div>
  );
}
