'use client';

import { Filter } from 'lucide-react';
import {
  ResponsiveMenu,
  ResponsiveMenuCheckboxItem,
  ResponsiveMenuLabel,
  ResponsiveMenuSeparator,
  ResponsiveMenuActionItem,
} from '@/components/ui/responsive-menu';
import { cn } from '@/lib/utils';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSource = 'server' | 'client' | 'service-worker';

const LEVEL_OPTIONS: { value: LogLevel; label: string }[] = [
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];

const SOURCE_OPTIONS: { value: LogSource; label: string }[] = [
  { value: 'server', label: 'Server' },
  { value: 'client', label: 'Client' },
  { value: 'service-worker', label: 'Service Worker' },
];

interface LogsFilterMenuProps {
  levels: Set<LogLevel>;
  sources: Set<LogSource>;
  onToggleLevel: (value: LogLevel) => void;
  onToggleSource: (value: LogSource) => void;
  onReset: () => void;
}

export function LogsFilterMenu({
  levels,
  sources,
  onToggleLevel,
  onToggleSource,
  onReset,
}: LogsFilterMenuProps) {
  const activeCount = levels.size + sources.size;

  return (
    <ResponsiveMenu
      title="Filter"
      align="end"
      contentClassName="w-56"
      trigger={(
        <button
          type="button"
          className="relative h-10 w-10 flex items-center justify-center rounded-md border border-input bg-background hover:bg-accent active:bg-accent/80 transition-colors press-feedback"
          aria-label={`Filter${activeCount > 0 ? ` (${activeCount} active)` : ''}`}
        >
          <Filter className="h-4 w-4" />
          {activeCount > 0 && (
            <span
              className={cn(
                'absolute -top-1 -right-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-semibold',
                activeCount === 1 ? 'h-2 w-2' : 'h-4 min-w-[16px] px-1'
              )}
            >
              {activeCount > 1 ? activeCount : ''}
            </span>
          )}
        </button>
      )}
    >
      <ResponsiveMenuLabel>Level</ResponsiveMenuLabel>
      {LEVEL_OPTIONS.map((option) => (
        <ResponsiveMenuCheckboxItem
          key={option.value}
          checked={levels.has(option.value)}
          onCheckedChange={() => onToggleLevel(option.value)}
        >
          {option.label}
        </ResponsiveMenuCheckboxItem>
      ))}
      <ResponsiveMenuSeparator />
      <ResponsiveMenuLabel>Source</ResponsiveMenuLabel>
      {SOURCE_OPTIONS.map((option) => (
        <ResponsiveMenuCheckboxItem
          key={option.value}
          checked={sources.has(option.value)}
          onCheckedChange={() => onToggleSource(option.value)}
        >
          {option.label}
        </ResponsiveMenuCheckboxItem>
      ))}
      {activeCount > 0 && (
        <>
          <ResponsiveMenuSeparator />
          <ResponsiveMenuActionItem onSelect={onReset}>Reset filters</ResponsiveMenuActionItem>
        </>
      )}
    </ResponsiveMenu>
  );
}
