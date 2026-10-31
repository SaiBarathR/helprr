'use client';

import Link from '@/components/ui/app-link';
import { HardDrive, ListVideo, Rss, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

const ITEMS = [
  { id: 'feed', label: 'Feed', href: '/twitch', icon: Rss },
  { id: 'streamers', label: 'Streamers', href: '/twitch/streamers', icon: Users },
  { id: 'queue', label: 'Queue', href: '/twitch/queue', icon: ListVideo },
  { id: 'library', label: 'Library', href: '/twitch/library', icon: HardDrive },
] as const;

/** The Movies switch, keeping the active label on phones: these pages have no visible title. */
export function TwitchSubNav({ active }: { active: (typeof ITEMS)[number]['id'] }) {
  return (
    <nav
      aria-label="Twitch sections"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-card/60 p-0.5"
    >
      {ITEMS.map(({ id, label, href, icon: Icon }) => {
        const isActive = id === active;
        return (
          <Link
            key={id}
            href={href}
            aria-label={label}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 sm:px-3 py-1.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-[var(--hpr-amber)] text-[var(--hpr-ink)] shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className={cn(!isActive && 'hidden sm:inline')}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
