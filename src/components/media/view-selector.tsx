'use client';

import { LayoutGrid, List, Rows3, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MediaViewMode } from '@/lib/store';

type ViewMode = MediaViewMode | 'grouped';

const views: { value: ViewMode; icon: typeof LayoutGrid; label: string; hideOnMobile?: boolean; onlyWhenListed?: boolean }[] = [
  { value: 'grouped', icon: Rows3, label: 'Grouped', onlyWhenListed: true },
  { value: 'posters', icon: LayoutGrid, label: 'Posters' },
  { value: 'overview', icon: List, label: 'Overview' },
  { value: 'table', icon: Table2, label: 'Table', hideOnMobile: true },
];

export function ViewSelector<T extends ViewMode>({
  value,
  onChange,
  modes,
}: {
  value: T;
  onChange: (view: T) => void;
  /** Limits the choices, for lists that have no table view. Grouped appears only when listed. */
  modes?: T[];
}) {
  return (
    <div className="flex bg-muted/50 rounded-lg p-0.5 gap-0.5">
      {views.filter((view) => (modes ? modes.includes(view.value as T) : !view.onlyWhenListed)).map(({ value: v, icon: Icon, label, hideOnMobile }) => (
        <button
          key={v}
          onClick={() => onChange(v as T)}
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
