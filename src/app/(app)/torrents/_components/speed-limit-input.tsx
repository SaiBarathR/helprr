'use client';

import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatBytes } from '@/lib/format';

export function formatSpeedLimit(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return 'Unlimited';
  return `${formatBytes(bytesPerSec)}/s`;
}

/** A grouped-list row showing a speed limit; tapping it opens an inline editor. */
export function SpeedLimitInput({
  label,
  currentLimit,
  onSave,
}: {
  label: string;
  currentLimit: number;
  // Resolving false means the action layer already surfaced the failure (its
  // own toast) — skip the success toast and keep the editor open. A throw
  // means the failure hasn't been surfaced yet, so toast it here.
  onSave: (limitBytesPerSec: number) => Promise<boolean | void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<'KB/s' | 'MB/s'>('MB/s');
  const [saving, setSaving] = useState(false);

  const startEditing = () => {
    if (currentLimit > 0) {
      const mbVal = currentLimit / (1024 * 1024);
      if (mbVal >= 1) {
        setValue(mbVal.toFixed(1).replace(/\.0$/, ''));
        setUnit('MB/s');
      } else {
        setValue((currentLimit / 1024).toFixed(0));
        setUnit('KB/s');
      }
    } else {
      setValue('');
      setUnit('MB/s');
    }
    setEditing(true);
  };

  const handleSave = async (event: FormEvent) => {
    // A form, so the keyboard's return key saves too.
    event.preventDefault();
    const numVal = parseFloat(value);
    if (isNaN(numVal) || numVal < 0) {
      toast.error('Invalid speed value');
      return;
    }
    setSaving(true);
    const bytesPerSec = unit === 'MB/s' ? numVal * 1024 * 1024 : numVal * 1024;
    try {
      if (await onSave(Math.round(bytesPerSec)) !== false) {
        setEditing(false);
        toast.success(`${label} updated`);
      }
    } catch {
      toast.error(`Failed to set ${label.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUnlimited = async () => {
    setSaving(true);
    try {
      if (await onSave(0) !== false) {
        setEditing(false);
        toast.success(`${label} set to unlimited`);
      }
    } catch {
      toast.error(`Failed to set ${label.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="grouped-row w-full text-left hover:bg-foreground/[0.03] active:bg-foreground/5 transition-colors"
        onClick={startEditing}
      >
        <span className="text-sm">{label}</span>
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          {formatSpeedLimit(currentLimit)}
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </button>
    );
  }

  return (
    <form className="grouped-row grouped-row-stacked gap-3" onSubmit={handleSave}>
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min="0"
          step="0.1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0"
          aria-label={label}
          className="flex-1"
          autoFocus
        />
        <Select value={unit} onValueChange={(v) => setUnit(v as 'KB/s' | 'MB/s')}>
          <SelectTrigger aria-label={`${label} unit`} className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="KB/s">KB/s</SelectItem>
            <SelectItem value="MB/s">MB/s</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="flex-1" disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="outline" className="flex-1" onClick={handleUnlimited} disabled={saving}>
          Unlimited
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
