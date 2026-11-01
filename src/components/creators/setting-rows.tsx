'use client';

import type { ComponentProps, ReactNode } from 'react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/** 16px on phones: a smaller input makes iOS zoom the page when it is focused. */
export const ROW_INPUT = 'min-w-0 bg-transparent text-right text-base md:text-sm outline-none placeholder:text-muted-foreground';

/** A saved setting only changes for a real, different number: an empty field is not a 0. */
export function changedNumber(text: string, stored: number | undefined): number | null {
  const value = Number(text);
  return text.trim() === '' || !Number.isFinite(value) || value === stored ? null : value;
}

export function SwitchRow({ label, checked, disabled, dimmed, onCheckedChange, children }: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  /** The value comes from a layer below. */
  dimmed?: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="grouped-row gap-3">
      <span className="min-w-0 text-sm">{label}</span>
      <span className="flex shrink-0 items-center gap-3">
        {children}
        <Switch aria-label={label} className={cn(dimmed && 'opacity-50')} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
      </span>
    </div>
  );
}

export function NumberRow({ label, unit, ...input }: ComponentProps<'input'> & { label: string; unit?: string }) {
  return (
    <label className="grouped-row cursor-text gap-3">
      <span className="min-w-0 text-sm">{label}</span>
      <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
        <input type="number" inputMode="numeric" aria-label={label} {...input} className={cn(ROW_INPUT, 'w-20 text-foreground')} />
        {unit}
      </span>
    </label>
  );
}

export function TextRow({ label, ...input }: ComponentProps<'input'> & { label: string }) {
  return (
    <label className="grouped-row grouped-row-stacked cursor-text gap-1">
      <span className="text-sm">{label}</span>
      <input
        aria-label={label}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        {...input}
        className={cn(ROW_INPUT, 'w-full text-left text-muted-foreground focus:text-foreground')}
      />
    </label>
  );
}
