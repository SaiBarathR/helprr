'use client';

import { cloneElement, isValidElement, useId, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface FieldRowProps {
  label: string;
  hint?: string;
  active: boolean;
  children: ReactNode;
}

/**
 * Wraps a single rule field with active/inactive styling. When `active` is true
 * (the field has a meaningfully-set value), the label and hint are rendered at
 * full contrast so the user can pick out configured fields without parsing the
 * helper text.
 */
export function FieldRow({ label, hint, active, children }: FieldRowProps) {
  // Point the visible label at a lone Input or Switch so it is announced by
  // name; a control that brings its own id keeps it. Composite controls
  // (selects, size and range pickers) don't forward an id, so they are skipped
  // rather than left with a label that points at nothing.
  const generatedId = useId();
  const control =
    isValidElement<{ id?: string }>(children) && (children.type === Input || children.type === Switch) ? children : null;
  const controlId = control ? (control.props.id ?? generatedId) : undefined;
  return (
    <div className="flex flex-col gap-1" data-active={active ? 'true' : 'false'}>
      <Label
        htmlFor={controlId}
        className={`text-xs ${active ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
      >
        {label}
      </Label>
      <div>
        {control && !control.props.id ? cloneElement(control, { id: controlId }) : children}
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
