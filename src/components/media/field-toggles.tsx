'use client';

import { Settings2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import type { PosterSize } from '@/lib/store';

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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label="Toggle fields"
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {posterSize !== undefined && onPosterSizeChange && (
          <>
            <DropdownMenuLabel>Poster Size</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={posterSize} onValueChange={(v) => onPosterSizeChange(v as PosterSize)}>
              <DropdownMenuRadioItem value="small">Small</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="medium">Medium</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="large">Large</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel>Visible Fields</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {available.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt.value}
            checked={selected.includes(opt.value)}
            onCheckedChange={() => toggle(opt.value)}
          >
            {opt.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
