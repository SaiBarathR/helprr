'use client';

import { useEffect, useState } from 'react';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import {
  format,
  startOfDay,
  endOfDay,
  startOfYesterday,
  endOfYesterday,
  subHours,
  subDays,
} from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { cn } from '@/lib/utils';

interface LogsDateRangePickerProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}

function toTimeInput(date: Date | undefined) {
  if (!date) return '';
  return format(date, 'HH:mm:ss');
}

function combineDateTime(date: Date | undefined, time: string): Date | undefined {
  if (!date) return undefined;
  const [hh = '0', mm = '0', ss = '0'] = (time || '00:00:00').split(':');
  const next = new Date(date);
  next.setHours(Number(hh) || 0, Number(mm) || 0, Number(ss) || 0, 0);
  return next;
}

function parseISO(input: string): Date | undefined {
  if (!input) return undefined;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function LogsDateRangePicker({ from, to, onChange }: LogsDateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const fromDate = parseISO(from);
  const toDate = parseISO(to);

  const [range, setRange] = useState<DateRange | undefined>(
    fromDate || toDate ? { from: fromDate, to: toDate } : undefined
  );
  const [fromTime, setFromTime] = useState(toTimeInput(fromDate) || '00:00:00');
  const [toTime, setToTime] = useState(toTimeInput(toDate) || '23:59:59');
  const [isDesktop, setIsDesktop] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRange(fromDate || toDate ? { from: fromDate, to: toDate } : undefined);
    setFromTime(toTimeInput(fromDate) || '00:00:00');
    setToTime(toTimeInput(toDate) || '23:59:59');
    setRangeError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const hasValue = Boolean(fromDate || toDate);

  const triggerLabel = (() => {
    if (!hasValue) return 'Any time';
    const fromLabel = fromDate ? format(fromDate, 'MMM d, HH:mm') : '…';
    const toLabel = toDate ? format(toDate, 'MMM d, HH:mm') : '…';
    return `${fromLabel} — ${toLabel}`;
  })();

  function applyPreset(nextFrom: Date, nextTo: Date) {
    setRangeError(null);
    setRange({ from: nextFrom, to: nextTo });
    setFromTime(format(nextFrom, 'HH:mm:ss'));
    setToTime(format(nextTo, 'HH:mm:ss'));
    onChange(nextFrom.toISOString(), nextTo.toISOString());
    setOpen(false);
  }

  const presets: { label: string; run: () => void }[] = [
    {
      label: 'Last hour',
      run: () => {
        const now = new Date();
        applyPreset(subHours(now, 1), now);
      },
    },
    {
      label: 'Last 24h',
      run: () => {
        const now = new Date();
        applyPreset(subHours(now, 24), now);
      },
    },
    {
      label: 'Last 7d',
      run: () => {
        const now = new Date();
        applyPreset(subDays(now, 7), now);
      },
    },
    {
      label: 'Today',
      run: () => applyPreset(startOfDay(new Date()), endOfDay(new Date())),
    },
    {
      label: 'Yesterday',
      run: () => applyPreset(startOfYesterday(), endOfYesterday()),
    },
  ];

  function handleApply() {
    const nextFrom = combineDateTime(range?.from, fromTime);
    const nextTo = combineDateTime(range?.to ?? range?.from, toTime);
    if (nextFrom && nextTo && nextFrom > nextTo) {
      setRangeError('“From” must be before “To”.');
      return;
    }
    setRangeError(null);
    if (!nextFrom && !nextTo) {
      onChange('', '');
    } else {
      onChange(nextFrom ? nextFrom.toISOString() : '', nextTo ? nextTo.toISOString() : '');
    }
    setOpen(false);
  }

  function handleClear() {
    setRange(undefined);
    setFromTime('00:00:00');
    setToTime('23:59:59');
    setRangeError(null);
    onChange('', '');
    setOpen(false);
  }

  const triggerNode = (
    <button
      type="button"
      className={cn(
        'flex items-center gap-2 px-3 hover:bg-accent active:bg-accent/80 transition-colors press-feedback text-sm',
        hasValue ? 'text-foreground' : 'text-muted-foreground'
      )}
      aria-label={`Date range: ${triggerLabel}`}
    >
      <CalendarIcon className="h-4 w-4 shrink-0" />
      <span className="truncate font-mono text-xs hidden sm:inline">{triggerLabel}</span>
      <span className="truncate font-mono text-xs sm:hidden">
        {hasValue ? format(fromDate ?? toDate ?? new Date(), 'MMM d') : 'Date'}
      </span>
    </button>
  );

  const triggerWrapper = (
    <div
      className={cn(
        'relative inline-flex items-stretch h-10 rounded-md border border-input bg-background overflow-hidden',
        hasValue && 'border-primary/30'
      )}
    >
      {isDesktop ? (
        <PopoverTrigger asChild>{triggerNode}</PopoverTrigger>
      ) : (
        <DrawerTrigger asChild>{triggerNode}</DrawerTrigger>
      )}
      {hasValue && (
        <button
          type="button"
          aria-label="Clear date range"
          onClick={handleClear}
          className="flex h-full w-7 items-center justify-center border-l border-input text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  const presetsRow = (
    <div className="flex flex-wrap gap-1.5 border-b border-border p-3">
      {presets.map((preset) => (
        <button
          key={preset.label}
          type="button"
          onClick={preset.run}
          className="rounded-full border border-input bg-background px-2.5 py-1 text-xs hover:bg-accent active:bg-accent/80 transition-colors"
        >
          {preset.label}
        </button>
      ))}
    </div>
  );

  const calendarNode = (
    <div className="flex justify-center">
      <Calendar
        mode="range"
        selected={range}
        onSelect={setRange}
        numberOfMonths={isDesktop ? 2 : 1}
        className="p-3"
      />
    </div>
  );

  const footerNode = (
    <div className="border-t border-border p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="block text-[11px] tracked-caps text-muted-foreground">From time</span>
          <Input
            type="time"
            step={1}
            value={fromTime}
            onChange={(event) => setFromTime(event.target.value)}
            className="h-10 max-w-fit"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] tracked-caps text-muted-foreground">To time</span>
          <Input
            type="time"
            step={1}
            value={toTime}
            onChange={(event) => setToTime(event.target.value)}
            className="h-10 max-w-fit"
          />
        </label>
      </div>
      {rangeError && (
        <p role="alert" className="text-xs text-destructive">
          {rangeError}
        </p>
      )}
      <div className="flex justify-between gap-2 py-4 max-w-fit">
        <Button
          variant="secondary"
          size="lg"
          className='w-full'
          onClick={handleClear}
          disabled={!hasValue && !range?.from && !range?.to}
        >
          Clear
        </Button>
        <Button
          className='w-full'

          size="lg" onClick={handleApply} disabled={!range?.from && !range?.to}>
          Apply
        </Button>
      </div>
    </div>
  );

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        {triggerWrapper}
        <PopoverContent align="start" className="w-auto max-w-[calc(100vw-1rem)] p-0">
          {presetsRow}
          {calendarNode}
          {footerNode}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      {triggerWrapper}
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader className="border-b border-border">
          <DrawerTitle className="tracked-caps text-xs text-muted-foreground">
            Date range
          </DrawerTitle>
        </DrawerHeader>
        <div className="overflow-y-auto">
          {presetsRow}
          {calendarNode}
        </div>
        {footerNode}
      </DrawerContent>
    </Drawer>
  );
}
