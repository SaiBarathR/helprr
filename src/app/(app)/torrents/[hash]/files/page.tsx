'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, ChevronRight, ChevronDown, Download, Folder, File, Gauge, Loader2, X } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatBytes } from '@/lib/format';
import { getRefreshIntervalMs } from '@/lib/client-refresh-settings';
import { useCan } from '@/components/permission-provider';
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
  const canManage = useCan('torrents.manage');

  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(5000);
  const queryClient = useQueryClient();
  const filesKey = ['qbittorrent', hash, 'files'] as const;

  // Optimistic priority change. A 401 carries its status to the global
  // MutationCache handler (redirect to /login).
  const setPriorityMutation = useMutation({
    mutationFn: async ({ fileIds, priority }: { fileIds: number[]; priority: number }) => {
      const res = await fetch(`/api/qbittorrent/${hash}/files/priority`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: fileIds, priority }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new ApiError(res.status, data?.error || 'Failed to set priority');
      }
    },
    onMutate: async ({ fileIds, priority }) => {
      // Cancel any in-flight poll so it can't clobber the optimistic value.
      await queryClient.cancelQueries({ queryKey: filesKey });
      const previous = queryClient.getQueryData<{ files: TorrentFile[] }>(filesKey);
      queryClient.setQueryData<{ files: TorrentFile[] }>(filesKey, (old) =>
        old
          ? { ...old, files: old.files.map((f) => (fileIds.includes(f.index) ? { ...f, priority } : f)) }
          : old,
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(filesKey, context.previous);
      // 401 is handled globally (redirect to /login); only toast other failures.
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : 'Failed to set priority');
    },
  });
  const { mutate: mutatePriority, isPending: priorityPending } = setPriorityMutation;

  const filesQuery = useQuery({
    queryKey: filesKey,
    queryFn: jsonFetcher<{ files: TorrentFile[] }>(`/api/qbittorrent/${hash}/details`),
    select: (d) => d.files ?? [],
    // Pause polling while a priority change is in flight so the next poll can't
    // overwrite the optimistic update before the server commits (matches the old
    // pendingMutationRef guard).
    refetchInterval: () => (priorityPending ? false : refreshIntervalMs),
    refetchIntervalInBackground: false,
  });
  const files = useMemo(() => filesQuery.data ?? [], [filesQuery.data]);
  const loading = filesQuery.isLoading;
  const error = filesQuery.error;

  useEffect(() => {
    async function loadRefreshInterval() {
      const ms = await getRefreshIntervalMs('torrentsRefreshIntervalSecs', 5);
      setRefreshIntervalMs(ms);
    }
    loadRefreshInterval();
  }, []);

  const tree = useMemo(() => buildFileTree(files), [files]);

  const totalSize = useMemo(() => files.reduce((sum, f) => sum + f.size, 0), [files]);
  const weightedProgress = useMemo(() => {
    if (totalSize === 0) return 0;
    const wp = files.reduce((sum, f) => sum + f.progress * f.size, 0);
    return wp / totalSize;
  }, [files, totalSize]);

  const setPriority = useCallback((fileIds: number[], priority: number) => {
    mutatePriority({ fileIds, priority });
  }, [mutatePriority]);

  // Toggle file download (priority 0 <-> 1)
  const toggleFileDownload = useCallback((fileIds: number[], currentlySelected: boolean) => {
    const newPriority = currentlySelected ? 0 : 1;
    setPriority(fileIds, newPriority);
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
        <PageHeader name={torrentName} canManage={canManage} onBack={() => router.back()} />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error && files.length === 0) {
    return (
      <div className="space-y-3">
        <PageHeader name={torrentName} canManage={canManage} onBack={() => router.back()} />
        <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">
          <p>{error?.message ?? 'Failed to fetch files'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-content-in">
      <PageHeader name={torrentName} canManage={canManage} onBack={() => router.back()} />

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
            canManage={canManage}
            onToggleDir={toggleDir}
            onToggleDownload={toggleFileDownload}
            onSetPriority={setPriority}
          />
        ))}
      </div>
    </div>
  );
}

function PageHeader({ name, canManage, onBack }: { name: string; canManage: boolean; onBack: () => void }) {
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
        <p className="text-xs text-muted-foreground mt-0.5">{canManage ? 'Manage Files' : 'Files'}</p>
      </div>
    </div>
  );
}

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  expandedDirs: Set<string>;
  canManage: boolean;
  onToggleDir: (path: string) => void;
  onToggleDownload: (fileIds: number[], currentlySelected: boolean) => void;
  onSetPriority: (fileIds: number[], priority: number) => void;
}

function TreeNodeRow({
  node,
  depth,
  expandedDirs,
  canManage,
  onToggleDir,
  onToggleDownload,
  onSetPriority,
}: TreeNodeRowProps) {
  if (node.type === 'file') {
    return (
      <FileRow
        node={node}
        depth={depth}
        canManage={canManage}
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
      canManage={canManage}
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
  canManage,
  onToggleDir,
  onToggleDownload,
  onSetPriority,
}: TreeNodeRowProps & { node: DirNode }) {
  const expanded = expandedDirs.has(node.path);
  const checkState = getCheckState(node);
  const progress = node.totalSize > 0 ? node.weightedProgress / node.totalSize : 0;
  const indent = Math.min(depth, 4) * 16;
  const allIndices = getAllFileIndices(node);

  const handleCheckboxChange = () => {
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
          {canManage && (
            <span className="relative flex items-center justify-center shrink-0">
              <input
                type="checkbox"
                checked={checkState === 'all'}
                aria-label={`Select ${node.name}`}
                ref={(el) => {
                  if (el) el.indeterminate = checkState === 'indeterminate';
                }}
                onChange={handleCheckboxChange}
                className="rounded border-border h-4 w-4"
              />
            </span>
          )}

          {/* Expand toggle + folder icon + name */}
          <QuickContextMenu
            label={`Actions for ${node.name}`}
            groups={[
              {
                id: 'folder',
                actions: [
                  {
                    id: 'toggle-folder',
                    label: expanded ? 'Collapse folder' : 'Expand folder',
                    icon: expanded
                      ? <ChevronDown className="h-4 w-4" />
                      : <ChevronRight className="h-4 w-4" />,
                    onSelect: () => onToggleDir(node.path),
                  },
                  ...(canManage
                    ? [{
                        id: 'toggle-download',
                        label: checkState === 'all' ? 'Skip all files' : 'Download all files',
                        icon: checkState === 'all'
                          ? <X className="h-4 w-4" />
                          : <Download className="h-4 w-4" />,
                        onSelect: () => onToggleDownload(allIndices, checkState === 'all'),
                      }]
                    : []),
                ],
              },
              {
                id: 'priority',
                actions: canManage
                  ? PRIORITY_OPTIONS.filter((option) => option.value !== '0').map((option) => ({
                      id: `priority-${option.value}`,
                      label: `${option.label} priority`,
                      icon: <Gauge className="h-4 w-4" />,
                      onSelect: () => onSetPriority(allIndices, Number(option.value)),
                    }))
                  : [],
              },
            ]}
          >
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
          </QuickContextMenu>

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
            canManage={canManage}
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
  canManage,
  onToggleDownload,
  onSetPriority,
}: {
  node: FileNode;
  depth: number;
  canManage: boolean;
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
        <QuickContextMenu
          label={`Actions for ${node.name}`}
          groups={[
            {
              id: 'download',
              actions: canManage
                ? [{
                    id: 'toggle-download',
                    label: isSelected ? 'Skip file' : 'Download file',
                    icon: isSelected
                      ? <X className="h-4 w-4" />
                      : <Download className="h-4 w-4" />,
                    onSelect: () => onToggleDownload([file.index], isSelected),
                  }]
                : [],
            },
            {
              id: 'priority',
              actions: canManage
                ? PRIORITY_OPTIONS.filter((option) => option.value !== '0').map((option) => ({
                    id: `priority-${option.value}`,
                    label: `${option.label} priority`,
                    icon: <Gauge className="h-4 w-4" />,
                    disabled: Number(option.value) === file.priority,
                    onSelect: () => onSetPriority([file.index], Number(option.value)),
                  }))
                : [],
            },
          ]}
        >
          <div className="flex items-start gap-2">
            {canManage && (
              <input
                type="checkbox"
                checked={isSelected}
                aria-label={`Select ${node.name}`}
                onChange={() => onToggleDownload([file.index], isSelected)}
                className="rounded border-border h-4 w-4 mt-0.5 shrink-0"
              />
            )}
            <File className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
            <span className="text-xs break-all line-clamp-2 leading-snug flex-1">{node.name}</span>
            <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
              {formatBytes(file.size)}
            </span>
          </div>
        </QuickContextMenu>

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
            {canManage ? (
            <Select
              value={String(file.priority)}
              onValueChange={(val) => {
                const p = Number(val);
                if (p !== file.priority) {
                  onSetPriority([file.index], p);
                }
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label={`Priority for ${node.name}`}
                className="h-6 text-[10px] px-2 min-w-[70px] border-border/50"
              >
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
            ) : (
              <span className="text-[10px] text-muted-foreground">
                {PRIORITY_OPTIONS.find((option) => Number(option.value) === file.priority)?.label ?? `Priority ${file.priority}`}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
