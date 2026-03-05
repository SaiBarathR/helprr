'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, ChevronRight, ChevronDown, Folder, File, Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatBytes } from '@/lib/format';
import { getRefreshIntervalMs } from '@/lib/client-refresh-settings';
import type { TorrentFile } from '@/lib/qbittorrent-client';
import {
  buildFileTree,
  getAllFileIndices,
  getCheckState,
  type TreeNode,
  type DirNode,
  type FileNode,
} from '@/lib/torrent-file-tree';

const PRIORITY_OPTIONS = [
  { value: '0', label: 'Skip' },
  { value: '1', label: 'Normal' },
  { value: '6', label: 'High' },
  { value: '7', label: 'Max' },
];

export default function TorrentFilesPage() {
  const params = useParams<{ hash: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const hash = params.hash;
  const torrentName = searchParams.get('name') || 'Torrent Files';

  const [files, setFiles] = useState<TorrentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(5000);

  const pendingMutationRef = useRef(false);

  // Fetch files from the existing details endpoint
  const fetchFiles = useCallback(async () => {
    // Skip refresh if a mutation is in-flight
    if (pendingMutationRef.current) return;

    try {
      const res = await fetch(`/api/qbittorrent/${hash}/details`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setFiles(data.files as TorrentFile[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch files');
    } finally {
      setLoading(false);
    }
  }, [hash]);

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  useEffect(() => {
    async function loadRefreshInterval() {
      const ms = await getRefreshIntervalMs('torrentsRefreshIntervalSecs', 5);
      setRefreshIntervalMs(ms);
    }
    loadRefreshInterval();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      void fetchFiles();
    }, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [fetchFiles, refreshIntervalMs]);

  const tree = useMemo(() => buildFileTree(files), [files]);

  const totalSize = useMemo(() => files.reduce((sum, f) => sum + f.size, 0), [files]);
  const weightedProgress = useMemo(() => {
    if (totalSize === 0) return 0;
    const wp = files.reduce((sum, f) => sum + f.progress * f.size, 0);
    return wp / totalSize;
  }, [files, totalSize]);

  // Set priority via API with optimistic update
  const setPriority = useCallback(async (fileIds: number[], priority: number) => {
    pendingMutationRef.current = true;

    // Optimistic update
    const prevFiles = files;
    setFiles((prev) =>
      prev.map((f) => (fileIds.includes(f.index) ? { ...f, priority } : f))
    );

    try {
      const res = await fetch(`/api/qbittorrent/${hash}/files/priority`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: fileIds, priority }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to set priority');
      }
    } catch (err) {
      // Revert on error
      setFiles(prevFiles);
      toast.error(err instanceof Error ? err.message : 'Failed to set priority');
    } finally {
      pendingMutationRef.current = false;
    }
  }, [files, hash]);

  // Toggle file download (priority 0 <-> 1)
  const toggleFileDownload = useCallback((fileIds: number[], currentlySelected: boolean) => {
    const newPriority = currentlySelected ? 0 : 1;
    void setPriority(fileIds, newPriority);
  }, [setPriority]);

  // Toggle directory expand/collapse
  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  if (loading && files.length === 0) {
    return (
      <div className="space-y-3">
        <PageHeader name={torrentName} onBack={() => router.back()} />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error && files.length === 0) {
    return (
      <div className="space-y-3">
        <PageHeader name={torrentName} onBack={() => router.back()} />
        <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PageHeader name={torrentName} onBack={() => router.back()} />

      {/* Summary bar */}
      <div className="rounded-xl bg-card p-3 space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{files.length} file{files.length !== 1 ? 's' : ''}</span>
          <span>{formatBytes(totalSize)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Progress value={weightedProgress * 100} className="h-1.5 flex-1" />
          <span className="text-xs text-muted-foreground shrink-0">
            {(weightedProgress * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* File tree */}
      <div className="rounded-xl bg-card overflow-hidden">
        {tree.map((node) => (
          <TreeNodeRow
            key={node.type === 'file' ? `f-${node.file.index}` : `d-${node.path}`}
            node={node}
            depth={0}
            expandedDirs={expandedDirs}
            onToggleDir={toggleDir}
            onToggleDownload={toggleFileDownload}
            onSetPriority={setPriority}
          />
        ))}
      </div>
    </div>
  );
}

function PageHeader({ name, onBack }: { name: string; onBack: () => void }) {
  return (
    <div className="flex items-start gap-3">
      <button
        onClick={onBack}
        className="p-2 -ml-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent shrink-0"
        aria-label="Go back"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <div className="min-w-0 pt-2">
        <h1 className="text-sm font-medium break-all line-clamp-2 leading-snug">{name}</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Manage Files</p>
      </div>
    </div>
  );
}

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onToggleDownload: (fileIds: number[], currentlySelected: boolean) => void;
  onSetPriority: (fileIds: number[], priority: number) => void;
}

function TreeNodeRow({
  node,
  depth,
  expandedDirs,
  onToggleDir,
  onToggleDownload,
  onSetPriority,
}: TreeNodeRowProps) {
  if (node.type === 'file') {
    return (
      <FileRow
        node={node}
        depth={depth}
        onToggleDownload={onToggleDownload}
        onSetPriority={onSetPriority}
      />
    );
  }

  return (
    <DirRow
      node={node}
      depth={depth}
      expandedDirs={expandedDirs}
      onToggleDir={onToggleDir}
      onToggleDownload={onToggleDownload}
      onSetPriority={onSetPriority}
    />
  );
}

function DirRow({
  node,
  depth,
  expandedDirs,
  onToggleDir,
  onToggleDownload,
  onSetPriority,
}: TreeNodeRowProps & { node: DirNode }) {
  const expanded = expandedDirs.has(node.path);
  const checkState = getCheckState(node);
  const progress = node.totalSize > 0 ? node.weightedProgress / node.totalSize : 0;
  const indent = Math.min(depth, 4) * 16;

  const handleCheckboxChange = () => {
    const allIndices = getAllFileIndices(node);
    onToggleDownload(allIndices, checkState === 'all');
  };

  return (
    <>
      <div className="border-b border-border/50">
        <div
          className="flex items-center gap-2 px-3 py-2.5"
          style={{ paddingLeft: `${12 + indent}px` }}
        >
          {/* Checkbox */}
          <span className="relative flex items-center justify-center shrink-0">
            <input
              type="checkbox"
              checked={checkState === 'all'}
              ref={(el) => {
                if (el) el.indeterminate = checkState === 'indeterminate';
              }}
              onChange={handleCheckboxChange}
              className="rounded border-border h-4 w-4"
            />
          </span>

          {/* Expand toggle + folder icon + name */}
          <button
            className="flex items-center gap-1.5 min-w-0 flex-1"
            onClick={() => onToggleDir(node.path)}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-xs font-medium truncate">{node.name}</span>
          </button>

          {/* Stats */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {node.selectedCount}/{node.fileCount}
            </span>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {formatBytes(node.totalSize)}
            </span>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {(progress * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      </div>

      {expanded &&
        node.children.map((child) => (
          <TreeNodeRow
            key={child.type === 'file' ? `f-${child.file.index}` : `d-${child.path}`}
            node={child}
            depth={depth + 1}
            expandedDirs={expandedDirs}
            onToggleDir={onToggleDir}
            onToggleDownload={onToggleDownload}
            onSetPriority={onSetPriority}
          />
        ))}
    </>
  );
}

function FileRow({
  node,
  depth,
  onToggleDownload,
  onSetPriority,
}: {
  node: FileNode;
  depth: number;
  onToggleDownload: (fileIds: number[], currentlySelected: boolean) => void;
  onSetPriority: (fileIds: number[], priority: number) => void;
}) {
  const { file } = node;
  const isSelected = file.priority > 0;
  const indent = Math.min(depth, 4) * 16;
  const remaining = file.size * (1 - file.progress);

  return (
    <div className="border-b border-border/50">
      <div
        className="px-3 py-2.5 space-y-1.5"
        style={{ paddingLeft: `${12 + indent}px` }}
      >
        {/* Row 1: checkbox + icon + name */}
        <div className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleDownload([file.index], isSelected)}
            className="rounded border-border h-4 w-4 mt-0.5 shrink-0"
          />
          <File className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
          <span className="text-xs break-all line-clamp-2 leading-snug flex-1">{node.name}</span>
          <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
            {formatBytes(file.size)}
          </span>
        </div>

        {/* Row 2: progress bar */}
        <div className="flex items-center gap-2 ml-[calc(16px+8px)]">
          <Progress value={file.progress * 100} className="h-1 flex-1" />
          <span className="text-[10px] text-muted-foreground shrink-0">
            {(file.progress * 100).toFixed(0)}%
          </span>
        </div>

        {/* Row 3: remaining, availability, priority */}
        <div className="flex items-center gap-3 ml-[calc(16px+8px)] flex-wrap">
          {file.priority === 0 ? (
            <span className="text-[10px] text-muted-foreground">Skipped</span>
          ) : file.progress < 1 && remaining > 0 ? (
            <span className="text-[10px] text-muted-foreground">
              Remaining: {formatBytes(remaining)}
            </span>
          ) : file.progress >= 1 ? (
            <span className="text-[10px] text-green-500">Complete</span>
          ) : null}

          {file.availability >= 0 && (
            <span className="text-[10px] text-muted-foreground">
              Avail: {(file.availability * 100).toFixed(0)}%
            </span>
          )}

          <div className="ml-auto">
            <Select
              value={String(file.priority)}
              onValueChange={(val) => {
                const p = Number(val);
                if (p !== file.priority) {
                  onSetPriority([file.index], p);
                }
              }}
            >
              <SelectTrigger size="sm" className="h-6 text-[10px] px-2 min-w-[70px] border-border/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                {PRIORITY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
