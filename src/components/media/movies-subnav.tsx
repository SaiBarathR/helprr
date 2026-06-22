'use client';

import Link from 'next/link';
import { Film, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

const ITEMS = [
  { id: 'library', label: 'Library', href: '/movies', icon: Film },
  { id: 'collections', label: 'Collections', href: '/movies/collections', icon: Layers },
] as const;

/** Segmented Library | Collections switch shown at the top of both movie views. */
export function MoviesSubNav({ active }: { active: 'library' | 'collections' }) {
  return (
    <nav
      aria-label="Movies sections"
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card/60 p-0.5"
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
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
