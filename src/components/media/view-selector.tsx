'use client';

import { LayoutGrid, List, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MediaViewMode } from '@/lib/store';

const views: { value: MediaViewMode; icon: typeof LayoutGrid; label: string; hideOnMobile?: boolean }[] = [
  { value: 'posters', icon: LayoutGrid, label: 'Posters' },
  { value: 'overview', icon: List, label: 'Overview' },
  { value: 'table', icon: Table2, label: 'Table', hideOnMobile: true },
];

export function ViewSelector({
  value,
  onChange,
}: {
  value: MediaViewMode;
  onChange: (view: MediaViewMode) => void;
}) {
  return (
    <div
      className="flex items-center bg-card/40 border border-[color:var(--hairline)] p-0.5 gap-0.5"
      style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
    >
      {views.map(({ value: v, icon: Icon, label, hideOnMobile }) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={cn(
            'relative h-8 w-8 inline-flex items-center justify-center transition-colors',
            value === v
              ? 'text-[color:var(--amber)]'
              : 'text-muted-foreground/70 hover:text-foreground',
            hideOnMobile && 'hidden md:inline-flex'
          )}
          style={{ borderRadius: 'calc(var(--radius) - 3px)' }}
          aria-label={label}
          title={label}
        >
          {value === v && (
            <span
              aria-hidden
              className="absolute inset-0 bg-[color:var(--amber-soft)] border border-[color:var(--amber)]/30"
              style={{ borderRadius: 'inherit' }}
            />
          )}
          <Icon className="relative h-4 w-4" />
        </button>
      ))}
    </div>
  );
}
