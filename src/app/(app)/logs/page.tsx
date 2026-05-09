'use no memo';
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { Loader2 } from 'lucide-react';
import { LogsToolbar } from './logs-toolbar';
import { LogsActiveFilters } from './logs-active-filters';
import { LogsFilesSheet, type LogFile } from './logs-files-sheet';
import { LogsEntryRow, type LogEntry } from './logs-entry-row';
import type { LogLevel, LogSource } from './logs-filter-menu';

function entryKey(entry: LogEntry, index: number) {
  return `${entry.timestampUtc}-${entry.requestId ?? index}`;
}

export default function LogsPage() {
  const [files, setFiles] = useState<LogFile[]>([]);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState('all');
  const [level, setLevel] = useState<LogLevel>('all');
  const [source, setSource] = useState<LogSource>('all');
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filesSheetOpen, setFilesSheetOpen] = useState(false);
  const [scrollMargin, setScrollMargin] = useState(0);

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
      if (level !== 'all') params.set('level', level);
      if (source !== 'all') params.set('source', source);
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
  }, [from, level, query, selectedFile, source, to]);

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

  const downloadSelected = useCallback(() => {
    if (selectedFile === 'all') return;
    window.location.href = `/api/logs/download?file=${encodeURIComponent(selectedFile)}`;
  }, [selectedFile]);

  const downloadFile = useCallback((file: string) => {
    window.location.href = `/api/logs/download?file=${encodeURIComponent(file)}`;
  }, []);

  const deleteFile = useCallback(
    async (file: string) => {
      if (!window.confirm(`Delete ${file}? This cannot be undone.`)) return;
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

  const handleResetFilters = useCallback(() => {
    setLevel('all');
    setSource('all');
  }, []);

  const handleClearAll = useCallback(() => {
    setLevel('all');
    setSource('all');
    setSearchInput('');
    setQuery('');
    setFrom('');
    setTo('');
    setSelectedFile('all');
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
      level !== 'all' ||
      source !== 'all' ||
      query !== '' ||
      from !== '' ||
      to !== '' ||
      selectedFile !== 'all',
    [from, level, query, selectedFile, source, to]
  );

  return (
    <div className="animate-content-in pb-6 space-y-2">
      <LogsToolbar
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        files={files}
        selectedFile={selectedFile}
        onSelectFile={setSelectedFile}
        level={level}
        source={source}
        onLevelChange={setLevel}
        onSourceChange={setSource}
        onResetFilters={handleResetFilters}
        from={from}
        to={to}
        onDateRangeChange={handleDateRangeChange}
        onOpenFilesSheet={() => setFilesSheetOpen(true)}
        onRefresh={refresh}
        loading={loading}
        onDownload={downloadSelected}
      />

      {hasFilters && (
        <LogsActiveFilters
          level={level}
          source={source}
          from={from}
          to={to}
          selectedFile={selectedFile}
          query={query}
          onClearLevel={() => setLevel('all')}
          onClearSource={() => setSource('all')}
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
        onDeleteFile={(file) => void deleteFile(file)}
        deletingFile={deletingFile}
      />
    </div>
  );
}
