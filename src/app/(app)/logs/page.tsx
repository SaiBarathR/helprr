'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { LogsToolbar } from './logs-toolbar';
import { LogsActiveFilters } from './logs-active-filters';
import { LogsFilesSheet, type LogFile } from './logs-files-sheet';
import { LogsEntryRow, type LogEntry } from './logs-entry-row';
import type { LogLevel, LogSource } from './logs-filter-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

function entryKey(entry: LogEntry, index: number) {
  return `${entry.timestampUtc}-${entry.requestId ?? index}`;
}

function isIosDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function filenameFromContentDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = header.match(/filename="?([^";]+)"?/i);
  return match?.[1]?.trim() || fallback;
}

async function downloadOrShare(url: string, fallbackName: string) {
  const toastId = toast.loading('Preparing download…');
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const blob = await response.blob();
    const filename = filenameFromContentDisposition(
      response.headers.get('content-disposition'),
      fallbackName
    );

    if (isIosDevice() && typeof navigator !== 'undefined' && 'share' in navigator) {
      const file = new File([blob], filename, { type: blob.type || 'application/x-ndjson' });
      if (navigator.canShare?.({ files: [file] })) {
        toast.dismiss(toastId);
        try {
          await navigator.share({ files: [file], title: filename });
          return;
        } catch (error) {
          if ((error as Error).name === 'AbortError') return;
          // fall through to anchor download
        }
      }
    }

    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    toast.dismiss(toastId);
  } catch (error) {
    console.error('[logs download]', error);
    toast.error('Download failed', { id: toastId });
  }
}

export default function LogsPage() {
  const [files, setFiles] = useState<LogFile[]>([]);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState('all');
  const [levels, setLevels] = useState<Set<LogLevel>>(() => new Set());
  const [sources, setSources] = useState<Set<LogSource>>(() => new Set());
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filesSheetOpen, setFilesSheetOpen] = useState(false);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [pendingDeleteFile, setPendingDeleteFile] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => setQuery(searchInput.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const loadFiles = useCallback(async () => {
    const response = await fetch('/api/logs/files');
    if (!response.ok) return;
    const payload = await response.json();
    setFiles(Array.isArray(payload.files) ? payload.files : []);
  }, []);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '1000' });
      if (selectedFile !== 'all') params.set('file', selectedFile);
      if (levels.size > 0) params.set('level', [...levels].join(','));
      if (sources.size > 0) params.set('source', [...sources].join(','));
      if (query) params.set('q', query);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const response = await fetch(`/api/logs/search?${params.toString()}`);
      if (!response.ok) return;
      const payload = await response.json();
      setEntries(Array.isArray(payload.entries) ? payload.entries : []);
    } finally {
      setLoading(false);
    }
  }, [from, levels, query, selectedFile, sources, to]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const handleListRef = useCallback((node: HTMLDivElement | null) => {
    listRef.current = node;
    setScrollMargin(node?.offsetTop ?? 0);
  }, []);

  useEffect(() => {
    function handleResize() {
      if (listRef.current) {
        setScrollMargin(listRef.current.offsetTop);
      }
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const useVirtualization = entries.length > 0;
  const virtualizer = useWindowVirtualizer({
    count: entries.length,
    estimateSize: () => 88,
    enabled: useVirtualization,
    overscan: 8,
    scrollMargin,
  });

  const refresh = useCallback(() => {
    void loadFiles();
    void loadLogs();
  }, [loadFiles, loadLogs]);

  const downloadCurrent = useCallback(() => {
    const params = new URLSearchParams();
    if (selectedFile !== 'all') params.set('file', selectedFile);
    if (levels.size > 0) params.set('level', [...levels].join(','));
    if (sources.size > 0) params.set('source', [...sources].join(','));
    if (query) params.set('q', query);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    const url = qs ? `/api/logs/download?${qs}` : '/api/logs/download';
    void downloadOrShare(url, 'helprr-logs.jsonl');
  }, [from, levels, query, selectedFile, sources, to]);

  const downloadFile = useCallback((file: string) => {
    const url = `/api/logs/download?file=${encodeURIComponent(file)}`;
    void downloadOrShare(url, file);
  }, []);

  const performDeleteFile = useCallback(
    async (file: string) => {
      setDeletingFile(file);
      try {
        const response = await fetch(`/api/logs/files?file=${encodeURIComponent(file)}`, {
          method: 'DELETE',
        });
        if (!response.ok) return;
        if (selectedFile === file) setSelectedFile('all');
        await loadFiles();
        await loadLogs();
      } finally {
        setDeletingFile(null);
      }
    },
    [loadFiles, loadLogs, selectedFile]
  );

  const deleteFile = useCallback((file: string) => {
    setPendingDeleteFile(file);
  }, []);

  const handleResetFilters = useCallback(() => {
    setLevels(new Set());
    setSources(new Set());
  }, []);

  const handleClearAll = useCallback(() => {
    setLevels(new Set());
    setSources(new Set());
    setSearchInput('');
    setQuery('');
    setFrom('');
    setTo('');
    setSelectedFile('all');
  }, []);

  const handleToggleLevel = useCallback((value: LogLevel) => {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  const handleToggleSource = useCallback((value: LogSource) => {
    setSources((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  const handleDateRangeChange = useCallback((nextFrom: string, nextTo: string) => {
    setFrom(nextFrom);
    setTo(nextTo);
  }, []);

  const toggleExpand = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const totalSize = virtualizer.getTotalSize();
  const virtualItems = virtualizer.getVirtualItems();
  const hasFilters = useMemo(
    () =>
      levels.size > 0 ||
      sources.size > 0 ||
      query !== '' ||
      from !== '' ||
      to !== '' ||
      selectedFile !== 'all',
    [from, levels, query, selectedFile, sources, to]
  );

  const hasSearchFilters = levels.size > 0 || sources.size > 0 || query !== '' || from !== '' || to !== '';
  const downloadLabel = hasSearchFilters
    ? 'Download filtered logs'
    : selectedFile !== 'all'
      ? `Download ${selectedFile}`
      : 'Download all logs';

  return (
    <div className="animate-content-in pb-6 space-y-2">
      <LogsToolbar
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        files={files}
        selectedFile={selectedFile}
        onSelectFile={setSelectedFile}
        levels={levels}
        sources={sources}
        onToggleLevel={handleToggleLevel}
        onToggleSource={handleToggleSource}
        onResetFilters={handleResetFilters}
        from={from}
        to={to}
        onDateRangeChange={handleDateRangeChange}
        onOpenFilesSheet={() => setFilesSheetOpen(true)}
        onRefresh={refresh}
        loading={loading}
        onDownload={downloadCurrent}
        downloadLabel={downloadLabel}
      />

      {hasFilters && (
        <LogsActiveFilters
          levels={levels}
          sources={sources}
          from={from}
          to={to}
          selectedFile={selectedFile}
          query={query}
          onToggleLevel={handleToggleLevel}
          onToggleSource={handleToggleSource}
          onClearDateRange={() => handleDateRangeChange('', '')}
          onClearFile={() => setSelectedFile('all')}
          onClearQuery={() => {
            setSearchInput('');
            setQuery('');
          }}
          onClearAll={handleClearAll}
        />
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span className="tracked-caps">
          {loading ? 'Loading…' : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`}
          {entries.length >= 1000 && (
            <span className="ml-2 text-foreground/60 normal-case tracking-normal">
              (cap reached, narrow filters)
            </span>
          )}
        </span>
        {expanded.size > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(new Set())}
            className="hover:text-foreground transition-colors"
          >
            Collapse all ({expanded.size})
          </button>
        )}
      </div>

      <div className="rounded-xl bg-card overflow-hidden">
        {loading && entries.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
            Loading logs
          </div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            No matching log entries
          </div>
        ) : (
          <div
            ref={handleListRef}
            className="relative w-full"
            style={{ height: totalSize }}
          >
            {virtualItems.map((virtualItem) => {
              const entry = entries[virtualItem.index];
              const key = entryKey(entry, virtualItem.index);
              const isExpanded = expanded.has(key);
              return (
                <LogsEntryRow
                  key={key}
                  ref={virtualizer.measureElement}
                  entry={entry}
                  isExpanded={isExpanded}
                  onToggle={() => toggleExpand(key)}
                  dataIndex={virtualItem.index}
                  style={{
                    transform: `translateY(${virtualItem.start - (virtualizer.options.scrollMargin ?? 0)}px)`,
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      <LogsFilesSheet
        open={filesSheetOpen}
        onOpenChange={setFilesSheetOpen}
        files={files}
        selectedFile={selectedFile}
        onSelectFile={setSelectedFile}
        onDownloadFile={downloadFile}
        onDeleteFile={deleteFile}
        deletingFile={deletingFile}
      />
      <ConfirmDialog
        open={pendingDeleteFile !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteFile(null); }}
        title={pendingDeleteFile ? `Delete ${pendingDeleteFile}?` : 'Delete file?'}
        description="This cannot be undone."
        confirmLabel="Delete"
        destructive
        busy={deletingFile !== null}
        onConfirm={async () => {
          if (!pendingDeleteFile) return;
          const target = pendingDeleteFile;
          setPendingDeleteFile(null);
          await performDeleteFile(target);
        }}
      />
    </div>
  );
}
