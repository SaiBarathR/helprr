'use client';

import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

export interface FilterOption {
  id: string;
  label: string;
}

/** One labelled, single-choice block of a filter menu. The menu stays open to pick from others. */
export function FilterGroup({ label, options, value, onChange, separated = true }: {
  label: string;
  options: FilterOption[];
  value: string;
  onChange: (next: string) => void;
  separated?: boolean;
}) {
  return (
    <>
      {separated && <DropdownMenuSeparator />}
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      {options.map((option) => (
        <DropdownMenuCheckboxItem
          key={option.id}
          checked={value === option.id}
          onCheckedChange={() => onChange(option.id)}
          onSelect={(event) => event.preventDefault()}
        >
          {option.label}
        </DropdownMenuCheckboxItem>
      ))}
    </>
  );
}
