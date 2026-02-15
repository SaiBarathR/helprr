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
            'p-1.5 rounded-md transition-colors',
            value === v
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
            hideOnMobile && 'hidden md:block'
          )}
          aria-label={label}
          title={label}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}
