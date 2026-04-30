'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS } from '@/lib/nav-config';

const routeTitles: Record<string, string> = Object.fromEntries(
  NAV_ITEMS.map((item) => [item.href, item.label])
);

export function Header() {
  const pathname = usePathname();

  const isTopLevel = Object.keys(routeTitles).includes(pathname);
  const title = routeTitles[pathname];

  return (
    <header className="md:hidden sticky top-0 z-40 border-b border-border/50 bg-background/70 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
      {/* Hairline glow */}
      <div
        aria-hidden
        className="absolute inset-x-6 bottom-0 h-px pointer-events-none"
        style={{
          background:
            'linear-gradient(90deg, transparent, var(--amber-soft), transparent)',
        }}
      />
      <div className="flex items-center h-12 px-4">
        {isTopLevel && title ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="marquee-dot shrink-0" />
            <span className="tracked-caps text-[10px] text-muted-foreground/80 shrink-0">
              {title === 'Notifications' ? 'Alerts' : title}
            </span>
          </div>
        ) : (
          <Link href="/dashboard" className="flex items-baseline gap-2">
            <span className="font-display text-xl leading-none tracking-[-0.04em] font-medium">
              <span className="italic">Help</span>
              <span style={{ color: 'var(--amber)' }}>rr</span>
            </span>
            <span className="marquee-dot translate-y-[-1px]" />
          </Link>
        )}
      </div>
    </header>
  );
}
