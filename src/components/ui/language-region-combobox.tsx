'use client';

import { useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { ResponsiveCombobox } from '@/components/ui/responsive-combobox';

export interface LanguageRegionComboboxProps {
  value: string;
  onChange: (code: string) => void;
  options: Array<{ code: string; name: string }>;
  /** The phone sheet's heading. */
  title: string;
  placeholder: string;
  emptyLabel: string;
  searchPlaceholder: string;
}

export function LanguageRegionCombobox({
  value,
  onChange,
  options,
  title,
  placeholder,
  emptyLabel,
  searchPlaceholder,
}: LanguageRegionComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((opt) => opt.code === value);
  const label = selected ? selected.name : value ? value.toUpperCase() : placeholder;

  return (
    <ResponsiveCombobox
      open={open}
      onOpenChange={setOpen}
      title={title}
      searchPlaceholder={searchPlaceholder}
      trigger={
        <button
          type="button"
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-left flex items-center justify-between"
        >
          <span className={`truncate ${selected ? '' : 'text-muted-foreground'}`}>{label}</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rotate-90" />
        </button>
      }
    >
      <CommandEmpty>No matches.</CommandEmpty>
      <CommandGroup>
        <CommandItem
          value={emptyLabel}
          onSelect={() => {
            onChange('');
            setOpen(false);
          }}
        >
          <span className="flex-1">{emptyLabel}</span>
          {!value && <Check className="h-3.5 w-3.5" />}
        </CommandItem>
        {/* The current pick first, so its tick is in view, not 200 rows down. */}
        {(selected ? [selected, ...options.filter((opt) => opt !== selected)] : options).map((opt) => (
          <CommandItem
            key={opt.code}
            value={`${opt.name} ${opt.code}`}
            onSelect={() => {
              onChange(opt.code);
              setOpen(false);
            }}
          >
            <span className="flex-1 truncate">{opt.name}</span>
            <span className="text-xs text-muted-foreground uppercase">{opt.code}</span>
            {value === opt.code && <Check className="h-3.5 w-3.5 ml-1" />}
          </CommandItem>
        ))}
      </CommandGroup>
    </ResponsiveCombobox>
  );
}
