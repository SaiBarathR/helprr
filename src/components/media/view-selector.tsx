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
    <div className="flex bg-muted/50 rounded-lg p-0.5 gap-0.5">
      {views.map(({ value: v, icon: Icon, label, hideOnMobile }) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={cn(
            'p-1.5 min-h-[40px] min-w-[40px] items-center justify-center rounded-md transition-colors',
            value === v
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
            hideOnMobile ? 'hidden md:flex' : 'flex'
          )}
          aria-label={label}
          aria-pressed={value === v}
          title={label}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}
