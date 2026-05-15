'use client';

import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';

interface FieldRowProps {
  label: string;
  hint?: string;
  active: boolean;
  children: ReactNode;
}

/**
 * Wraps a single rule field with active/inactive styling. When `active` is true
 * (the field has a meaningfully-set value), the label is rendered at full
 * contrast and the input wrapper gets a subtle primary-tinted ring so the user
 * can pick out configured fields without parsing the helper text.
 */
export function FieldRow({ label, hint, active, children }: FieldRowProps) {
  return (
    <div className="flex flex-col gap-1" data-active={active ? 'true' : 'false'}>
      <Label
        className={`text-xs ${active ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
      >
        {label}
      </Label>
      <div
        className={
          active
            ? 'rounded-md ring-1 ring-primary/40 ring-offset-1 ring-offset-background'
            : ''
        }
      >
        {children}
      </div>
      {hint && (
        <p
          className={`text-[11px] leading-tight ${active ? 'text-muted-foreground' : 'text-muted-foreground/60'}`}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

// ── Helpers for callers to decide what counts as "active" ──────────────

export function isNumericActive(v: number | null | undefined, disabledSentinel: number = -1): boolean {
  return v !== null && v !== undefined && v !== disabledSentinel;
}

export function isRangeActive(min: number, max: number): boolean {
  return min > 0 || max < 100;
}

export function isArrayActive(arr: readonly unknown[] | null | undefined): boolean {
  return Array.isArray(arr) && arr.length > 0;
}
