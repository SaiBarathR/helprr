'use client';

import Link from '@/components/ui/app-link';
import { Rss, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

const ITEMS = [
  { id: 'feed', label: 'Feed', href: '/twitch', icon: Rss },
  { id: 'streamers', label: 'Streamers', href: '/twitch/streamers', icon: Users },
] as const;

/** Segmented switch shown at the top of every Twitch section. */
export function TwitchSubNav({ active }: { active: (typeof ITEMS)[number]['id'] }) {
  return (
    <nav aria-label="Twitch sections" className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card/60 p-0.5">
      {ITEMS.map(({ id, label, href, icon: Icon }) => {
        const isActive = id === active;
        return (
          <Link
            key={id}
            href={href}
            aria-label={label}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 sm:px-3 py-1.5 text-sm font-medium transition-colors',
              isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
