'use client';

import { Filter } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type LogLevel = 'all' | 'debug' | 'info' | 'warn' | 'error';
export type LogSource = 'all' | 'server' | 'client' | 'service-worker';

const LEVEL_OPTIONS: { value: LogLevel; label: string }[] = [
  { value: 'all', label: 'All levels' },
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];

const SOURCE_OPTIONS: { value: LogSource; label: string }[] = [
  { value: 'all', label: 'All sources' },
  { value: 'server', label: 'Server' },
  { value: 'client', label: 'Client' },
  { value: 'service-worker', label: 'Service Worker' },
];

interface LogsFilterMenuProps {
  level: LogLevel;
  source: LogSource;
  onLevelChange: (value: LogLevel) => void;
  onSourceChange: (value: LogSource) => void;
  onReset: () => void;
}

export function LogsFilterMenu({
  level,
  source,
  onLevelChange,
  onSourceChange,
  onReset,
}: LogsFilterMenuProps) {
  const activeCount = (level !== 'all' ? 1 : 0) + (source !== 'all' ? 1 : 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="tracked-caps text-[11px] text-muted-foreground">
          Level
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={level} onValueChange={(value) => onLevelChange(value as LogLevel)}>
          {LEVEL_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="tracked-caps text-[11px] text-muted-foreground">
          Source
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={source}
          onValueChange={(value) => onSourceChange(value as LogSource)}
        >
          {SOURCE_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {activeCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onReset} className="text-muted-foreground">
              Reset filters
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
