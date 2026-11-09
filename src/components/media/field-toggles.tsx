'use client';

import { Settings2 } from 'lucide-react';
import {
  ResponsiveMenu,
  ResponsiveMenuCheckboxItem,
  ResponsiveMenuLabel,
  ResponsiveMenuSeparator,
} from '@/components/ui/responsive-menu';
import type { PosterSize } from '@/lib/store';

const POSTER_SIZES: { value: PosterSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

interface FieldOption {
  value: string;
  label: string;
}

export function FieldToggles({
  available,
  selected,
  onChange,
  posterSize,
  onPosterSizeChange,
}: {
  available: FieldOption[];
  selected: string[];
  onChange: (fields: string[]) => void;
  posterSize?: PosterSize;
  onPosterSizeChange?: (size: PosterSize) => void;
}) {
  function toggle(field: string) {
    if (selected.includes(field)) {
      onChange(selected.filter((f) => f !== field));
    } else {
      onChange([...selected, field]);
    }
  }

  return (
    <ResponsiveMenu
      title="View options"
      contentClassName="w-48"
      trigger={(
        <button
          className="relative touch-target p-1.5 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label="Toggle fields"
        >
          <Settings2 className="h-4 w-4" />
        </button>
      )}
    >
      {posterSize !== undefined && onPosterSizeChange && (
        <>
          <ResponsiveMenuLabel>Poster Size</ResponsiveMenuLabel>
          {POSTER_SIZES.map((size) => (
            <ResponsiveMenuCheckboxItem
              key={size.value}
              checked={posterSize === size.value}
              onCheckedChange={() => onPosterSizeChange(size.value)}
            >
              {size.label}
            </ResponsiveMenuCheckboxItem>
          ))}
          <ResponsiveMenuSeparator />
        </>
      )}
      <ResponsiveMenuLabel>Visible Fields</ResponsiveMenuLabel>
      {available.map((opt) => (
        <ResponsiveMenuCheckboxItem
          key={opt.value}
          checked={selected.includes(opt.value)}
          onCheckedChange={() => toggle(opt.value)}
        >
          {opt.label}
        </ResponsiveMenuCheckboxItem>
      ))}
    </ResponsiveMenu>
  );
}
