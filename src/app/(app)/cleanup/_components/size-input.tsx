'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Unit = 'KB' | 'MB' | 'GB';

const UNIT_FACTORS: Record<Unit, number> = {
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
};

const UNITS: Unit[] = ['KB', 'MB', 'GB'];

function bestUnitFor(bytes: number): Unit {
  if (bytes >= UNIT_FACTORS.GB) return 'GB';
  if (bytes >= UNIT_FACTORS.MB) return 'MB';
  return 'KB';
}

function bytesToString(bytes: number, unit: Unit): string {
  if (bytes === 0) return '0';
  const v = bytes / UNIT_FACTORS[unit];
  return parseFloat(v.toFixed(4)).toString();
}

interface SizeInputProps {
  bytes: number | null;
  onChange: (bytes: number | null) => void;
  placeholder?: string;
  defaultUnit?: Unit;
  ariaInvalid?: boolean;
}

/**
 * Byte-storage input with KB/MB/GB unit selector. Storage stays as bytes; the
 * unit is purely a display/entry concern.
 *
 * The displayed value is derived from `bytes` and the chosen unit on every
 * render — no mirrored state — so external resets (e.g. "Discard changes")
 * are reflected immediately without effect-driven syncs.
 */
export function SizeInput({
  bytes,
  onChange,
  placeholder,
  defaultUnit = 'MB',
  ariaInvalid,
}: SizeInputProps) {
  // Unit defaults to whatever fits the current bytes value; the user can
  // override and the choice persists for this mount.
  const [unit, setUnit] = useState<Unit>(
    bytes != null && bytes > 0 ? bestUnitFor(bytes) : defaultUnit,
  );

  const displayed = bytes != null ? bytesToString(bytes, unit) : '';

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      onChange(null);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return;
    onChange(Math.round(n * UNIT_FACTORS[unit]));
  };

  return (
    <div className="flex items-stretch gap-2">
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={displayed}
        placeholder={placeholder}
        onChange={(e) => commit(e.target.value)}
        aria-invalid={ariaInvalid}
        className="flex-1 min-w-0"
      />
      <Select value={unit} onValueChange={(v) => setUnit(v as Unit)}>
        <SelectTrigger className="w-20 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {UNITS.map((u) => (
            <SelectItem key={u} value={u}>
              {u}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Shared formatter used by rule summaries. Picks an appropriate unit and
 * returns "5 MB", "1.5 GB", etc. — keeps display consistent across cards.
 */
export function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes === 0) return '0';
  const unit = bestUnitFor(bytes);
  const v = bytes / UNIT_FACTORS[unit];
  return `${parseFloat(v.toFixed(2)).toString()} ${unit}`;
}
