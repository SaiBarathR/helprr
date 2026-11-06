'use client';

import {
  ResponsiveMenuCheckboxItem,
  ResponsiveMenuLabel,
  ResponsiveMenuSeparator,
} from '@/components/ui/responsive-menu';

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
      {separated && <ResponsiveMenuSeparator />}
      <ResponsiveMenuLabel>{label}</ResponsiveMenuLabel>
      {options.map((option) => (
        <ResponsiveMenuCheckboxItem
          key={option.id}
          checked={value === option.id}
          onCheckedChange={() => onChange(option.id)}
        >
          {option.label}
        </ResponsiveMenuCheckboxItem>
      ))}
    </>
  );
}
