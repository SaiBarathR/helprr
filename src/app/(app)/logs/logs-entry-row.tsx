'use client';

import { forwardRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export interface LogEntry {
  timestampUtc: string;
  timestampLocal: string;
  timeZone: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  scope?: string;
  requestId?: string;
  message: string;
  metadata?: unknown;
}

interface LogsEntryRowProps {
  entry: LogEntry;
  isExpanded: boolean;
  onToggle: () => void;
  dataIndex: number;
  style?: React.CSSProperties;
}

function stringifyEntry(entry: LogEntry) {
  const payload = {
    timestampUtc: entry.timestampUtc,
    timestampLocal: entry.timestampLocal,
    timeZone: entry.timeZone,
    level: entry.level,
    source: entry.source,
    scope: entry.scope,
    requestId: entry.requestId,
    message: entry.message,
    metadata: entry.metadata,
  };
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export const LogsEntryRow = forwardRef<HTMLDivElement, LogsEntryRowProps>(
  function LogsEntryRow({ entry, isExpanded, onToggle, dataIndex, style }, ref) {
    const [copied, setCopied] = useState(false);
    // Only serialized when expanded — metadata payloads can be large and the
    // JSON is unused while collapsed.
    const json = isExpanded ? stringifyEntry(entry) : '';

    async function handleCopy() {
      try {
        await navigator.clipboard.writeText(json);
        setCopied(true);
        toast.success('Copied to clipboard');
        window.setTimeout(() => setCopied(false), 1500);
      } catch {
        toast.error('Failed to copy');
      }
    }

    return (
      <div
        ref={ref}
        data-index={dataIndex}
        style={style}
        className="absolute top-0 left-0 w-full border-b border-foreground/[0.06]"
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          className="block w-full px-4 py-3 text-left active:bg-foreground/5 hover:bg-foreground/[0.02] transition-colors"
        >
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                    entry.level === 'error' && 'bg-red-500/15 text-red-400',
                    entry.level === 'warn' && 'bg-yellow-500/15 text-yellow-400',
                    entry.level === 'info' && 'bg-blue-500/15 text-blue-400',
                    entry.level === 'debug' && 'bg-muted text-muted-foreground'
                  )}
                >
                  {entry.level}
                </span>
                <span className="text-xs text-muted-foreground">{entry.source}</span>
                {entry.scope && (
                  <span className="text-xs text-muted-foreground">· {entry.scope}</span>
                )}
              </div>
              <div className="mt-1 break-words text-sm font-medium">{entry.message}</div>
            </div>
            <div className="shrink-0 text-right text-[11px] text-muted-foreground font-mono">
              <div>{entry.timestampLocal}</div>
              {entry.requestId && <div>{entry.requestId.slice(0, 8)}</div>}
            </div>
          </div>
        </button>
        {isExpanded && (
          <div className="relative px-4 pb-3">
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy entry as JSON"
              className="absolute right-6 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-background/80 text-muted-foreground hover:bg-background hover:text-foreground transition-colors"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <pre className="max-h-96 overflow-auto rounded-md bg-muted/40 p-3 pr-10 text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all">
              {json}
            </pre>
          </div>
        )}
      </div>
    );
  }
);
