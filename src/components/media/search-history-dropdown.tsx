'use client';

import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { History, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchHistoryDropdownProps {
  /** The element to anchor under (usually the search input's wrapper). */
  anchorRef: React.RefObject<HTMLDivElement | null>;
  items: string[];
  onSelect: (term: string) => void;
  onRemove: (term: string) => void;
}

type Mode =
  | { kind: 'inline' }
  | { kind: 'portal'; top: number; left: number; width: number };

// Recent-search list shown under a focused search bar.
//
// On normal pages the dropdown is rendered through a portal with fixed positioning
// so it escapes transformed/clipped ancestor stacking contexts (e.g. sibling
// `animate-content-in` sections) that would otherwise let list content paint over
// it. Inside a dialog/drawer it instead renders in-flow (absolute) so it shares the
// layer's stacking context and DOM — that keeps positioning correct under the
// drawer's transform and stops a click from dismissing the layer.
//
// Mouse-down is prevented so clicking a row doesn't blur (and commit) the input.
export function SearchHistoryDropdown({ anchorRef, items, onSelect, onRemove }: SearchHistoryDropdownProps) {
  const [mode, setMode] = useState<Mode | null>(null);

  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const inLayer = !!el.closest('[role="dialog"]');
    const update = () => {
      if (inLayer) {
        setMode({ kind: 'inline' });
        return;
      }
      const r = el.getBoundingClientRect();
      setMode({ kind: 'portal', top: r.bottom, left: r.left, width: r.width });
    };
    update();
    if (inLayer) return;
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchorRef, items.length]);

  if (items.length === 0 || !mode) return null;

  const rows = items.map((term) => (
    <div
      key={term}
      className="group flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
      onClick={() => onSelect(term)}
    >
      <History className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate">{term}</span>
      <button
        type="button"
        aria-label={`Remove ${term} from recent searches`}
        className={cn(
          'shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-60 transition-opacity',
          'hover:bg-background hover:text-foreground hover:opacity-100'
        )}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(term);
        }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  ));

  const listClass = 'max-h-64 overflow-y-auto rounded-md border bg-popover py-1 text-popover-foreground shadow-lg';

  if (mode.kind === 'inline') {
    return (
      <div className={cn('absolute left-0 right-0 top-full z-50 mt-1.5', listClass)} onMouseDown={(e) => e.preventDefault()}>
        {rows}
      </div>
    );
  }

  return createPortal(
    <div
      style={{ position: 'fixed', top: mode.top + 6, left: mode.left, width: mode.width, zIndex: 60 }}
      className={listClass}
      onMouseDown={(e) => e.preventDefault()}
    >
      {rows}
    </div>,
    document.body
  );
}
