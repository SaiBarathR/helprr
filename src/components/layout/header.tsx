'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, Settings, LogOut, Clapperboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function Header() {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-sm pt-[env(safe-area-inset-top)]">
      <div className="flex items-center justify-between h-14 px-4">
        <div className="flex items-center gap-2 md:hidden">
          <Clapperboard className="h-5 w-5 text-primary" />
          <span className="font-semibold">Helprr</span>
        </div>
        <div className="hidden md:block" />

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/notifications">
              <Bell className="h-4 w-4" />
            </Link>
          </Button>
          <Button variant="ghost" size="icon" asChild>
            <Link href="/settings">
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <LogOut className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
