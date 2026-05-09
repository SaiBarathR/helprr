'use client';

import { Download, FolderOpen, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LogsFilterMenu, type LogLevel, type LogSource } from './logs-filter-menu';
import { LogsDateRangePicker } from './logs-date-range-picker';
import { cn } from '@/lib/utils';

interface LogFile {
  name: string;
}

interface LogsToolbarProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  files: LogFile[];
  selectedFile: string;
  onSelectFile: (file: string) => void;
  level: LogLevel;
  source: LogSource;
  onLevelChange: (value: LogLevel) => void;
  onSourceChange: (value: LogSource) => void;
  onResetFilters: () => void;
  from: string;
  to: string;
  onDateRangeChange: (from: string, to: string) => void;
  onOpenFilesSheet: () => void;
  onRefresh: () => void;
  loading: boolean;
  onDownload: () => void;
}

const ICON_BUTTON_CLASS =
  'h-10 w-10 flex items-center justify-center rounded-md border border-input bg-background hover:bg-accent active:bg-accent/80 transition-colors press-feedback disabled:opacity-50 disabled:pointer-events-none';

export function LogsToolbar({
  searchInput,
  onSearchInputChange,
  files,
  selectedFile,
  onSelectFile,
  level,
  source,
  onLevelChange,
  onSourceChange,
  onResetFilters,
  from,
  to,
  onDateRangeChange,
  onOpenFilesSheet,
  onRefresh,
  loading,
  onDownload,
}: LogsToolbarProps) {
  const downloadEnabled = selectedFile !== 'all';

  return (
    <div
      className="sticky z-30 -mx-2 px-2 pt-1 pb-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6 space-y-2"
      style={{ top: 'var(--header-height, 0px)' }}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(event) => onSearchInputChange(event.target.value)}
          placeholder="Search logs"
          className="h-10 pl-9 pr-9"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => onSearchInputChange('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Select value={selectedFile} onValueChange={onSelectFile}>
          <SelectTrigger className="h-10 max-w-[160px] sm:max-w-[240px]" aria-label="Filter by log file">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All files</SelectItem>
            {files.map((file) => (
              <SelectItem key={file.name} value={file.name} className="font-mono text-xs">
                {file.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <LogsFilterMenu
          level={level}
          source={source}
          onLevelChange={onLevelChange}
          onSourceChange={onSourceChange}
          onReset={onResetFilters}
        />

        <LogsDateRangePicker from={from} to={to} onChange={onDateRangeChange} />

        <div className="flex-1" />

        <button
          type="button"
          onClick={onOpenFilesSheet}
          className={ICON_BUTTON_CLASS}
          aria-label="Manage log files"
        >
          <FolderOpen className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className={ICON_BUTTON_CLASS}
          aria-label="Refresh logs"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onDownload}
          disabled={!downloadEnabled}
          className={cn(ICON_BUTTON_CLASS)}
          aria-label={
            downloadEnabled ? `Download ${selectedFile}` : 'Select a single file to download'
          }
        >
          <Download className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
