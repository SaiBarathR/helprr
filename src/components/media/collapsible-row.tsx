'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/** An information row that opens to show a list under it (alternative titles, extra files). */
export function CollapsibleRow({
  label,
  summary,
  children,
  className,
}: {
  label: string;
  /** Shown beside the chevron while closed and open, e.g. a count. */
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between gap-4 py-2.5 text-left"
      >
        <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
        <span className="flex min-w-0 items-center gap-2 text-sm">
          {summary !== undefined && <span className="min-w-0 truncate text-right">{summary}</span>}
          <ChevronDown
            aria-hidden
            className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          />
        </span>
      </button>
      {open && <div id={contentId} className="pb-3">{children}</div>}
    </div>
  );
}
