'use client';

import Link from '@/components/ui/app-link';
import { HardDrive, ListVideo, Rss, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCreatorPlatform } from './platform';

/** The Movies switch, keeping the active label on phones: these pages have no visible title. */
export function CreatorSubNav({ active }: { active: 'feed' | 'streamers' | 'queue' | 'library' }) {
  const platform = useCreatorPlatform();
  const items = [
    { id: 'feed', label: 'Feed', href: platform.base, icon: Rss },
    { id: 'streamers', label: platform.creatorsLabel, href: platform.creatorsPath, icon: Users },
    { id: 'queue', label: 'Queue', href: `${platform.base}/queue`, icon: ListVideo },
    { id: 'library', label: 'Library', href: `${platform.base}/library`, icon: HardDrive },
  ];
  return (
    <nav
      aria-label={`${platform.name} sections`}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-card/60 p-0.5"
    >
      {items.map(({ id, label, href, icon: Icon }) => {
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
