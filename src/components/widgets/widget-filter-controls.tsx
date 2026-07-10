'use client';
import { ApiError } from '@/lib/query-fetch';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpDown, CalendarIcon, ChevronDown, Filter, RotateCcw } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Pill, HPR } from './bento-primitives';

// ─── Days select ───
// 0 = All time (mapped to MAX_DAYS by callers)

export interface DaysOption {
  value: number;
  label: string;
}

export const JELLYFIN_DAYS_OPTIONS: DaysOption[] = [
  { value: 1, label: '1 day' },
  { value: 3, label: '3 days' },
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 0, label: 'All time' },
];

export const PROWLARR_DAYS_OPTIONS: DaysOption[] = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 0, label: 'All time' },
];

export const MAX_DAYS = 18250;

export function daysToStartDate(days: number): string | undefined {
  if (days === 0) return undefined;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export function DaysSelect({
  value,
  onChange,
  options,
}: {
  value: number;
  onChange: (next: number) => void;
  options: DaysOption[];
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number.parseInt(v, 10))}>
      <SelectTrigger className="h-8 text-xs w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={String(opt.value)}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── User select (Jellyfin) ───

interface JellyfinUserOption {
  id: string;
  name: string;
}

export function UserSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  // Shared ['jellyfin','playback','user-list'] cache dedups across widget instances.
  const { data: users = [] } = useQuery({
    queryKey: ['jellyfin', 'playback', 'user-list'],
    queryFn: async ({ signal }): Promise<JellyfinUserOption[]> => {
      const res = await fetch('/api/jellyfin/playback/user-list', { signal });
      if (!res.ok) throw new ApiError(res.status, 'Request failed');
      const data = await res.json();
      return Array.isArray(data.users) ? (data.users as JellyfinUserOption[]) : [];
    },
    staleTime: 10 * 60_000,
  });

  return (
    <Select value={value || 'all'} onValueChange={(v) => onChange(v === 'all' ? '' : v)}>
      <SelectTrigger className="h-8 text-xs w-full">
        <SelectValue placeholder="All users" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All users</SelectItem>
        {users.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Type select (Jellyfin playback filters) ───

export function TypeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { data: filters = [] } = useQuery({
    queryKey: ['jellyfin', 'playback', 'filters'],
    queryFn: async ({ signal }): Promise<string[]> => {
      const res = await fetch('/api/jellyfin/playback/filters', { signal });
      if (!res.ok) throw new ApiError(res.status, 'Request failed');
      const data = await res.json();
      return Array.isArray(data.filters) ? (data.filters as string[]) : [];
    },
    staleTime: 10 * 60_000,
  });

  if (filters.length === 0) return null;

  return (
    <Select value={value || 'all'} onValueChange={(v) => onChange(v === 'all' ? '' : v)}>
      <SelectTrigger className="h-8 text-xs w-full">
        <SelectValue placeholder="All types" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All types</SelectItem>
        {filters.map((f) => (
          <SelectItem key={f} value={f}>
            {f}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Date range select ───

// date-fns, not toLocaleDateString: the label is server-rendered, and a locale
// difference between Node and the browser (e.g. "Jun 8" vs "8 Jun") is a
// hydration mismatch that regenerates the whole page tree on the client.
function fmtMonthDay(d: Date | undefined): string {
  if (!d) return '';
  return format(d, 'MMM d');
}

export function DateRangeSelect({
  value,
  onChange,
}: {
  value: DateRange | undefined;
  onChange: (range: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const fromStr = fmtMonthDay(value?.from);
  const toStr = fmtMonthDay(value?.to ?? value?.from);
  const label = !value?.from ? 'Select range' : fromStr === toStr ? fromStr : `${fromStr} — ${toStr}`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start text-left text-xs h-8 font-normal">
          <CalendarIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={value}
          onSelect={(range) => {
            if (range) onChange(range);
            if (range?.to) setOpen(false);
          }}
          disabled={{ after: new Date() }}
          numberOfMonths={1}
        />
      </PopoverContent>
    </Popover>
  );
}

// ─── Sort toggle (inline pill) ───

export type SortMode = 'plays' | 'duration';

export function SortTogglePill({
  value,
  onChange,
  disabled = false,
}: {
  value: SortMode;
  onChange: (next: SortMode) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : () => onChange(value === 'plays' ? 'duration' : 'plays')}
      style={{
        border: 'none',
        padding: 0,
        background: 'transparent',
        cursor: disabled ? 'default' : 'pointer',
      }}
      aria-label={`Sort by ${value === 'plays' ? 'duration' : 'plays'}`}
    >
      <Pill color={HPR.cyan}>
        <ArrowUpDown size={9} strokeWidth={2.4} />
        {/* "DURATION" → "DUR" on compact cells so the widget title keeps room. */}
        <span className="@max-[259px]/cell:hidden">{value === 'plays' ? 'PLAYS' : 'DURATION'}</span>
        <span className="hidden @max-[259px]/cell:inline">{value === 'plays' ? 'PLAYS' : 'DUR'}</span>
      </Pill>
    </button>
  );
}

// ─── Filter icon button (opens drawer) ───

export function FilterIconButton({
  active = false,
  onClick,
  disabled = false,
}: {
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      aria-label="Open filters"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 24,
        padding: 0,
        borderRadius: 999,
        color: active ? HPR.amber : HPR.fgMute,
        background: active ? 'color-mix(in oklab, var(--hpr-amber) 14%, transparent)' : 'transparent',
        border: `1px solid ${active ? 'color-mix(in oklab, var(--hpr-amber) 30%, transparent)' : HPR.hairline2}`,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <Filter size={12} strokeWidth={2.2} />
    </button>
  );
}

// ─── Inline days pill (cycles or opens select popover) ───

export function DaysPill({
  value,
  options,
  onChange,
  disabled = false,
  narrow = false,
}: {
  value: number;
  options: DaysOption[];
  onChange: (next: number) => void;
  disabled?: boolean;
  narrow?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? options[0];
  const compact = value === 0 ? 'ALL' : narrow ? `${value}D` : `${value} DAYS`;

  return (
    <Popover open={disabled ? false : open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          style={{
            border: 'none',
            padding: 0,
            background: 'transparent',
            cursor: disabled ? 'default' : 'pointer',
          }}
          aria-label={`Range: ${current.label}`}
        >
          <Pill color={HPR.amber}>
            {compact} <ChevronDown size={9} strokeWidth={2.4} />
          </Pill>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-32 p-1">
        <div className="flex flex-col">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`text-left text-xs px-2 py-1.5 rounded-md ${
                opt.value === value
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Filter row + drawer wrapper ───

export function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{label}</span>
      {children}
    </div>
  );
}

export function WidgetFilterDrawer({
  trigger,
  title = 'Filters',
  children,
  onReset,
  open,
  onOpenChange,
}: {
  trigger?: React.ReactNode;
  title?: string;
  children: React.ReactNode;
  onReset?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {trigger && <DrawerTrigger asChild>{trigger}</DrawerTrigger>}
      <DrawerContent>
        <DrawerHeader className="text-left flex flex-row items-center justify-between">
          <DrawerTitle className="text-sm">{title}</DrawerTitle>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="text-[11px] flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          )}
        </DrawerHeader>
        <div className="px-4 pb-8 flex-1 min-h-0 overflow-y-auto flex flex-col gap-4">
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
